import { expect, test } from 'bun:test'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { WorkerEnv } from './types'

import { libsql } from '../database/libsql'
import { workerstack } from '../index'
import { createFakeNamespace } from '../testing/workers-fakes'
import { createWorker } from './index'
import { registeredWorker, resetRegistryForTests } from './registry'

const notes = sqliteTable('notes', { id: text('id').primaryKey() })
const ctx = () => {
  const pending: Promise<unknown>[] = []
  return { waitUntil: (p: Promise<unknown>) => void pending.push(p), pending }
}

function backendWithJobs() {
  return workerstack({
    schema: { notes },
    database: { adapter: libsql() },
    jobs: (j) =>
      j.define({
        beat: j.cron({ schedule: '* * * * *', handler: async () => {} }),
      }),
  })
}

test('fetch serves the API and falls back to assets on 404', async () => {
  const worker = createWorker(backendWithJobs())
  const env = {
    DATABASE_URL: ':memory:',
    ASSETS: { fetch: async () => new Response('<html>spa</html>') },
  }
  const health = await worker.handler.fetch(
    new Request('https://app.test/api/health'),
    env,
    ctx(),
  )
  expect(health.status).toBe(200)
  const page = await worker.handler.fetch(
    new Request('https://app.test/boards/1'),
    env,
    ctx(),
  )
  expect(await page.text()).toBe('<html>spa</html>')
})

test('an API 404 and a request with a body are never handed to the assets', async () => {
  const worker = createWorker(backendWithJobs())
  const assetCalls: string[] = []
  const env = {
    DATABASE_URL: ':memory:',
    ASSETS: {
      fetch: async (request: Request) => {
        assetCalls.push(`${request.method} ${new URL(request.url).pathname}`)
        return new Response('<html>spa</html>')
      },
    },
  }
  const missingApi = await worker.handler.fetch(
    new Request('https://app.test/api/no-such-route'),
    env,
    ctx(),
  )
  expect(missingApi.status).toBe(404)
  const post = await worker.handler.fetch(
    new Request('https://app.test/boards/1', {
      method: 'POST',
      body: JSON.stringify({ title: 'x' }),
      headers: { 'content-type': 'application/json' },
    }),
    env,
    ctx(),
  )
  expect(post.status).toBe(404)
  const head = await worker.handler.fetch(
    new Request('https://app.test/boards/1', { method: 'HEAD' }),
    env,
    ctx(),
  )
  expect(head.status).toBe(200)
  expect(assetCalls).toEqual(['HEAD /boards/1'])
})

test('isPageRequest is true only for GET or HEAD outside /api', async () => {
  const { isPageRequest } = await import('./index')
  expect(isPageRequest(new Request('https://a.test/boards'))).toBe(true)
  expect(isPageRequest(new Request('https://a.test/api/x'))).toBe(false)
  expect(isPageRequest(new Request('https://a.test/api'))).toBe(false)
  expect(isPageRequest(new Request('https://a.test/apidocs'))).toBe(true)
  expect(
    isPageRequest(new Request('https://a.test/boards', { method: 'POST' })),
  ).toBe(false)
})

test('a failed start is retried by the next request', async () => {
  const backend = backendWithJobs()
  let calls = 0
  const failing = {
    ...backend,
    start: async () => {
      calls++
      throw new Error('database is down')
    },
  } as unknown as typeof backend
  const worker = createWorker(failing)
  const request = () => new Request('https://app.test/api/health')
  await expect(worker.handler.fetch(request(), {}, ctx())).rejects.toThrow(
    'database is down',
  )
  await expect(worker.handler.fetch(request(), {}, ctx())).rejects.toThrow(
    'database is down',
  )
  expect(calls).toBe(2)
})

test('scheduled wakes the Scheduler', async () => {
  const worker = createWorker(backendWithJobs())
  const env: WorkerEnv = { DATABASE_URL: ':memory:' }
  const SCHEDULER = createFakeNamespace(
    (state) => new worker.durableObjects.Scheduler(state, env),
  )
  env.SCHEDULER = SCHEDULER
  const c = ctx()
  const before = Date.now()
  await worker.handler.scheduled({}, env, c)
  await Promise.all(c.pending)
  expect(SCHEDULER.state('main').alarmAt()).toBeGreaterThanOrEqual(before)
})

test('the first request starts the Scheduler once per isolate', async () => {
  const worker = createWorker(backendWithJobs())
  const env: WorkerEnv = { DATABASE_URL: ':memory:' }
  let notifies = 0
  const SCHEDULER = createFakeNamespace((state) => {
    const scheduler = new worker.durableObjects.Scheduler(state, env)
    return {
      fetch: (request: Request) => {
        notifies++
        return scheduler.fetch(request)
      },
    }
  })
  env.SCHEDULER = SCHEDULER
  for (let i = 0; i < 2; i++) {
    const c = ctx()
    await worker.handler.fetch(
      new Request('https://app.test/api/health'),
      env,
      c,
    )
    await Promise.all(c.pending)
  }
  expect(notifies).toBe(1)
  expect(SCHEDULER.state('main').alarmAt()).not.toBeNull()
})

test('app(env) is the app the fetch handler serves with', async () => {
  resetRegistryForTests()
  const worker = createWorker(backendWithJobs())
  const env = { DATABASE_URL: ':memory:' }
  const app = await worker.app(env)
  expect(registeredWorker()?.env).toBe(env)
  expect(typeof app.db.select).toBe('function')
  expect(await worker.app(env)).toBe(app)
  const health = await worker.handler.fetch(
    new Request('https://app.test/api/health'),
    env,
    ctx(),
  )
  expect(health.status).toBe(200)
})

test("an SSR loader's API call flushes telemetry through the page request", async () => {
  resetRegistryForTests()
  const { createStartWorker } = await import('../start/create-start-worker')
  const { createIsomorphicFetch } = await import('../start/isomorphic-fetch')
  const iso = createIsomorphicFetch({
    isolate: { request: async () => new Request('https://app.test/boards') },
  })
  const worker = createStartWorker(backendWithJobs(), async () => {
    // A loader reading through the API in the isolate.
    await iso('/api/health')
    return new Response('page')
  })
  const sent: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    sent.push(String(input))
    return new Response(null, { status: 204 })
  }) as typeof fetch
  try {
    const page = ctx()
    const response = await worker.handler.fetch(
      new Request('https://app.test/boards'),
      {
        DATABASE_URL: ':memory:',
        BUNDERHOST_TELEMETRY_URL: 'https://telemetry.test',
        BUNDERHOST_TELEMETRY_TOKEN: 'token',
      },
      page,
    )
    expect(await response.text()).toBe('page')
    // The page's own flush and the loader's API call both landed here.
    expect(page.pending.length).toBeGreaterThanOrEqual(2)
    await Promise.all(page.pending)
    expect(sent.every((url) => url === 'https://telemetry.test/events')).toBe(
      true,
    )
  } finally {
    globalThis.fetch = realFetch
  }
})
