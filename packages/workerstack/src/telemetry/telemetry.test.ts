import { ORPCError, call, os } from '@orpc/server'
import { expect, test } from 'bun:test'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { libsql } from '../database/libsql'
import { WorkerstackError } from '../errors'
import { defineApi, workerstack } from '../index'
import { normalizePath } from '../start/create-start-worker'
import { createTestLogs } from '../testing/logs'
import { createWorker } from '../workers/index'
import { telemetryMiddleware } from './middleware'
import {
  createTelemetry,
  describeError,
  noopTelemetry,
  statusClass,
  telemetryFromEnv,
} from './telemetry'

type Batch = {
  runtime: string
  version: string
  release?: string
  errors: Array<Record<string, unknown>>
  metrics: Array<{
    name: string
    labels: Record<string, string>
    value: number
  }>
}

function harness(options: { fail?: boolean } = {}) {
  const batches: Batch[] = []
  let now = 1_000_000
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    if (options.fail) throw new Error('connect ECONNREFUSED')
    batches.push((await request.json()) as Batch)
    return new Response(null, { status: 204 })
  }) as typeof fetch
  const { logger, logs } = createTestLogs()
  const telemetry = createTelemetry(
    {
      url: 'https://bunderhost.test/api/telemetry/v1',
      token: 'tok',
      release: 'rel1',
      runtime: 'workerstack',
      version: '0.2.0',
    },
    { fetch: fetchImpl, now: () => now, logger, intervalMs: 10_000 },
  )
  return { telemetry, batches, logs, advance: (ms: number) => void (now += ms) }
}

test('configuration needs both variables and picks up the Worker release', () => {
  expect(
    telemetryFromEnv({}, { runtime: 'workerstack', version: '1' }),
  ).toBeNull()
  expect(
    telemetryFromEnv(
      {
        BUNDERHOST_TELEMETRY_URL: 'https://x/api/telemetry/v1',
        BUNDERHOST_TELEMETRY_TOKEN: 't',
        WORKERSTACK_REVISION: 'abc',
      },
      { runtime: 'workerstack', version: '1' },
    ),
  ).toEqual({
    url: 'https://x/api/telemetry/v1',
    token: 't',
    release: 'abc',
    runtime: 'workerstack',
    version: '1',
  })
  expect(statusClass(404)).toBe('4xx')
  expect(noopTelemetry.enabled).toBe(false)
})

test('an error keeps its own message and carries the cause chain in the stack', () => {
  const driver = new Error('SQLITE_BUSY: database is locked')
  const wrapper = new Error('Failed query: select "id" from "agents"', {
    cause: driver,
  })
  const described = describeError(wrapper)
  expect(described.message).toBe('Failed query: select "id" from "agents"')
  expect(described.stack).toStartWith('Error: Failed query')
  expect(described.stack).toContain(
    'Caused by: Error: SQLITE_BUSY: database is locked',
  )

  const looped = new Error('outer')
  looped.cause = looped
  expect(describeError(looped).stack).not.toContain('Caused by')
  expect(
    describeError(new Error('outer', { cause: { code: 'ECONNRESET' } })).stack,
  ).toContain('Caused by: {"code":"ECONNRESET"}')
})

test('flushIfDue sends the first window of an isolate at once', async () => {
  const h = harness()
  h.telemetry.recordRequest({ route: 'a', status: 200, durationMs: 1 })
  await h.telemetry.flushIfDue()
  expect(h.batches).toHaveLength(1)
  expect(h.batches[0]).toMatchObject({
    runtime: 'workerstack',
    release: 'rel1',
  })
  expect(h.batches[0]!.metrics).toContainEqual({
    name: 'bh_app_requests',
    labels: { route: 'a', status: '2xx' },
    value: 1,
  })
})

test('flushIfDue then honours the ten-second Worker window', async () => {
  const h = harness()
  h.telemetry.recordRequest({ route: 'a', status: 200, durationMs: 1 })
  await h.telemetry.flushIfDue()
  h.telemetry.recordRequest({ route: 'a', status: 200, durationMs: 1 })
  await h.telemetry.flushIfDue()
  expect(h.batches).toHaveLength(1)
  h.advance(10_000)
  await h.telemetry.flushIfDue()
  expect(h.batches).toHaveLength(2)
})

test('flushIfDue sends an error without waiting for the window', async () => {
  const h = harness()
  h.telemetry.recordRequest({ route: 'a', status: 200, durationMs: 1 })
  await h.telemetry.flushIfDue()
  h.telemetry.captureException(new Error('boom'), { source: 'api' })
  await h.telemetry.flushIfDue()
  expect(h.batches).toHaveLength(2)
  expect(h.batches[1]!.errors).toHaveLength(1)
})

test('a failing endpoint drops the window and warns once', async () => {
  const h = harness({ fail: true })
  h.telemetry.captureException(new Error('x'), { source: 'api' })
  await h.telemetry.flush()
  h.telemetry.captureException(new Error('y'), { source: 'api' })
  await h.telemetry.flush()
  expect(h.logs.warnings).toHaveLength(1)
})

test('the middleware records every procedure and captures unexpected failures', async () => {
  const h = harness()
  const base = os
    .$context<{ request: Request }>()
    .use(telemetryMiddleware(h.telemetry) as never)
  const notFound = base.handler(() => {
    throw new ORPCError('NOT_FOUND')
  })
  const crash = base.handler(() => {
    throw new TypeError('boom')
  })
  const context = {
    request: new Request('https://shop.example/api/x', { method: 'POST' }),
  }
  await expect(
    call(notFound, undefined, { context, path: ['tasks', 'get'] }),
  ).rejects.toBeInstanceOf(ORPCError)
  await expect(
    call(crash, undefined, { context, path: ['tasks', 'complete'] }),
  ).rejects.toThrow('boom')
  await h.telemetry.flush()
  const [batch] = h.batches
  expect(batch!.errors).toEqual([
    expect.objectContaining({
      source: 'api',
      name: 'TypeError',
      context: expect.objectContaining({
        procedure: 'tasks.complete',
        status: 500,
      }),
    }),
  ])
  expect(batch!.metrics).toContainEqual({
    name: 'bh_app_requests',
    labels: { route: 'tasks.get', status: '4xx' },
    value: 1,
  })
  expect(
    normalizePath(
      'https://x/projects/42/tasks/task_01hx4k3m9zq8r7t6y5w2v1n0pa',
    ),
  ).toBe('/projects/:id/tasks/:id')
})

test('a Worker reports API failures through waitUntil and stays silent without the variables', async () => {
  const received: Batch[] = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      received.push((await request.json()) as Batch)
      return new Response(null, { status: 204 })
    },
  })
  const notes = sqliteTable('notes', { id: text('id').primaryKey() })
  const o = defineApi({ schema: { notes } })
  const api = {
    boom: o.public.route({ method: 'GET', path: '/api/boom' }).handler(() => {
      throw new Error('kaboom')
    }),
    refuse: o.public
      .route({ method: 'GET', path: '/api/refuse' })
      .handler(() => {
        throw new WorkerstackError('NOT_FOUND', 'nothing here')
      }),
  }
  const ctx = () => {
    const pending: Promise<unknown>[] = []
    return { waitUntil: (p: Promise<unknown>) => void pending.push(p), pending }
  }
  try {
    const backend = workerstack({
      schema: { notes },
      database: { adapter: libsql() },
      api,
    })
    const worker = createWorker(backend)
    const env = {
      DATABASE_URL: ':memory:',
      BUNDERHOST_TELEMETRY_URL: `http://localhost:${server.port}/api/telemetry/v1`,
      BUNDERHOST_TELEMETRY_TOKEN: 'tok',
      WORKERSTACK_REVISION: 'deadbeef',
    }
    const first = ctx()
    expect(
      (
        await worker.handler.fetch(
          new Request('https://app.test/api/refuse'),
          env,
          first,
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await worker.handler.fetch(
          new Request('https://app.test/api/boom'),
          env,
          first,
        )
      ).status,
    ).toBe(500)
    await Promise.all(first.pending)
    // The isolate's first window and the error left through waitUntil, with
    // no later request or tick needed: an idle isolate may never get one.
    expect(received).toHaveLength(2)
    expect(received[0]).toMatchObject({
      runtime: 'workerstack',
      release: 'deadbeef',
    })
    expect(received.flatMap((b) => b.errors.map((e) => e.message))).toEqual([
      'kaboom',
    ])
    const metrics = received.flatMap((b) => b.metrics)
    expect(metrics).toContainEqual({
      name: 'bh_app_requests',
      labels: { route: 'refuse', status: '4xx' },
      value: 1,
    })
    expect(metrics).toContainEqual({
      name: 'bh_app_requests',
      labels: { route: 'boom', status: '5xx' },
      value: 1,
    })

    const silent = createWorker(
      workerstack({ schema: { notes }, database: { adapter: libsql() }, api }),
    )
    const c = ctx()
    expect(
      (
        await silent.handler.fetch(
          new Request('https://app.test/api/boom'),
          { DATABASE_URL: ':memory:' },
          c,
        )
      ).status,
    ).toBe(500)
    await Promise.all(c.pending)
    expect(received).toHaveLength(2)
  } finally {
    server.stop(true)
  }
})
