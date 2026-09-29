import { expect, test } from 'bun:test'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import * as v from 'valibot'

import type { DatabaseAdapter } from '../database/adapter'

import { libsql } from '../database/libsql'
import { workerstack } from '../index'

const notes = sqliteTable('fixture_notes', {
  id: text('id').primaryKey(),
})

test('fixtures provision independently and dispose lexically', async () => {
  const backend = workerstack({
    schema: { notes },
    database: { adapter: libsql() },
  })

  await using a = await backend.test({ database: { schema: 'push' } })
  await using b = await backend.test({ database: { schema: 'push' } })

  await a.app.db.insert(notes).values({ id: 'only-a' })
  expect(await b.app.db.select().from(notes)).toEqual([])

  await a.close()
  await a.close()
  expect(await b.app.db.select().from(notes)).toEqual([])
})

test('each fixture resolves an env slot exactly once', async () => {
  let calls = 0
  const backend = workerstack({
    schema: { notes },
    env: { server: { TENANT: v.string() } },
    database: (env) => {
      calls++
      return { adapter: libsql(), url: `file:${env.TENANT}.db` }
    },
  })

  await using first = await backend.test({ env: { TENANT: 'first' } })
  await using second = await backend.test({ env: { TENANT: 'second' } })
  expect(first.app.env.TENANT).toBe('first')
  expect(second.app.env.TENANT).toBe('second')
  expect(calls).toBe(2)
})

test('configured fixtures merge defaults, expose setup context, and defer LIFO cleanup', async () => {
  const adapter = libsql()
  const strategy = adapter.testing!
  const modes: string[] = []
  adapter.testing = {
    async createTarget(options) {
      modes.push(options.mode)
      return strategy.createTarget(options)
    },
  }
  const cleanup: string[] = []
  const backend = workerstack({
    schema: { notes },
    env: {
      server: {
        FIXTURE_DEFAULT: v.string(),
        FIXTURE_OVERRIDE: v.string(),
      },
    },
    database: { adapter },
  })
  const createFixture = backend.test.configure({
    env: {
      FIXTURE_DEFAULT: 'kept',
      FIXTURE_OVERRIDE: 'default',
    },
    database: { mode: 'temporary', schema: 'push' },
    setup(fixture) {
      fixture.defer(() => cleanup.push('first'))
      fixture.defer(async () => cleanup.push('second'))
      return {
        label: `${fixture.app.env.FIXTURE_DEFAULT}:${fixture.app.env.FIXTURE_OVERRIDE}`,
      }
    },
  })

  await using fixture = await createFixture({
    env: { FIXTURE_OVERRIDE: 'per-test' },
    database: { schema: 'push' },
  })

  expect(fixture.context).toEqual({ label: 'kept:per-test' })
  expect(modes).toEqual(['temporary'])
  await fixture.close()
  await fixture.close()
  expect(cleanup).toEqual(['second', 'first'])
})

test('adapters without a test strategy are refused', async () => {
  const adapter: DatabaseAdapter = {
    driver: 'libsql',
    async connect() {
      throw new Error('must not connect')
    },
    async migrate() {},
  }
  const backend = workerstack({ schema: { notes }, database: { adapter } })

  await expect(backend.test()).rejects.toThrow(
    /explicit test database strategy/,
  )
})

test('libsql fixtures use independent in-memory targets', async () => {
  const backend = workerstack({
    schema: { notes },
    database: { adapter: libsql() },
  })

  await using a = await backend.test({ database: { schema: 'push' } })
  await using b = await backend.test({ database: { schema: 'push' } })
  await a.app.db.insert(notes).values({ id: 'only-a' })

  expect(await b.app.db.select().from(notes)).toEqual([])
})

test('setup failure disposes its allocated database target once', async () => {
  let disposals = 0
  const adapter: DatabaseAdapter = {
    driver: 'libsql',
    async connect() {
      throw new Error('runtime creation failed')
    },
    async migrate() {},
    testing: {
      async createTarget() {
        return {
          connection: { url: ':memory:' },
          async [Symbol.asyncDispose]() {
            disposals++
          },
        }
      },
    },
  }
  const backend = workerstack({
    schema: { notes },
    database: { adapter },
  })

  await expect(backend.test()).rejects.toThrow('runtime creation failed')
  expect(disposals).toBe(1)
})
