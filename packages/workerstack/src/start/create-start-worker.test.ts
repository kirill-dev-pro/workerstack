import { expect, test } from 'bun:test'

import { workerstack } from '../index'
import { registeredWorker, resetRegistryForTests } from '../workers/registry'
import { createStartWorker } from './create-start-worker'

test('routes /api to workerstack, other paths to Start, and registers the Worker', async () => {
  resetRegistryForTests()
  const backend = workerstack({
    schema: {},
    database: {
      adapter: {
        driver: 'libsql',
        async connect() {
          throw new Error('not used')
        },
        async migrate() {},
      },
    } as never,
  })
  const started: string[] = []
  const worker = createStartWorker(backend, async (request) => {
    started.push(new URL(request.url).pathname)
    return new Response('ssr')
  })
  // The env becomes known with the first request, even one that only renders.
  expect(registeredWorker()).toBeUndefined()
  const env = { AUTH_SECRET: 'x' }
  const page = await worker.handler.fetch(
    new Request('https://app.example/boards/1'),
    env,
    { waitUntil() {} },
  )
  expect(registeredWorker()?.env).toBe(env)
  expect(await page.text()).toBe('ssr')
  expect(started).toEqual(['/boards/1'])
  expect(Object.keys(worker.durableObjects).sort()).toEqual([
    'RateLimiter',
    'RealtimeHub',
    'Scheduler',
  ])
})

test('a rendered page starts the Scheduler too', async () => {
  resetRegistryForTests()
  const backend = workerstack({
    schema: {},
    database: { adapter: { driver: 'libsql' } } as never,
  })
  const worker = createStartWorker(backend, async () => new Response('ssr'))
  const notified: string[] = []
  const SCHEDULER = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (input: RequestInfo | URL) => {
        notified.push(new URL(String(input)).pathname)
        return new Response(null, { status: 204 })
      },
    }),
  }
  const pending: Promise<unknown>[] = []
  await worker.handler.fetch(
    new Request('https://app.example/'),
    { SCHEDULER } as never,
    { waitUntil: (p) => void pending.push(p) },
  )
  await Promise.all(pending)
  expect(notified).toHaveLength(1)
})

test('a timed render does not start the app', async () => {
  resetRegistryForTests()
  let connects = 0
  const backend = workerstack({
    schema: {},
    database: {
      adapter: {
        driver: 'libsql',
        async connect() {
          connects++
          throw new Error('not used')
        },
        async migrate() {},
      },
    } as never,
  })
  const worker = createStartWorker(backend, async () => new Response('ssr'))
  const sent: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(`${String(input)} ${String(init?.body)}`)
    return new Response(null, { status: 204 })
  }) as typeof fetch
  try {
    const pending: Promise<unknown>[] = []
    const page = await worker.handler.fetch(
      new Request('https://app.example/boards/42'),
      {
        BUNDERHOST_TELEMETRY_URL: 'https://telemetry.example',
        BUNDERHOST_TELEMETRY_TOKEN: 'token',
      },
      { waitUntil: (p) => void pending.push(p) },
    )
    await Promise.all(pending)
    expect(await page.text()).toBe('ssr')
    expect(connects).toBe(0)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toStartWith('https://telemetry.example/events ')
    expect(sent[0]).toContain('ssr /boards/:id')
  } finally {
    globalThis.fetch = realFetch
  }
})
