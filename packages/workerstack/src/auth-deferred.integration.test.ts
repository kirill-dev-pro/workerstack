import { expect, test } from 'bun:test'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { libsql } from './database/libsql'
import { workerstack } from './index'
import { provision } from './provision-schema'

const posts = sqliteTable('posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  userId: text('user_id'),
})

const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull(),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  token: text('token').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', {
    mode: 'timestamp',
  }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', {
    mode: 'timestamp',
  }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
})

const schema = { user, session, account, verification, posts }

/** An app whose auth builder counts how often it ran. */
function counted(withAuthModels = true) {
  const calls = { builds: 0 }
  const backend = workerstack({
    schema: withAuthModels ? schema : { posts },
    database: { url: ':memory:', adapter: libsql() },
    auth: () => {
      calls.builds++
      return { emailAndPassword: { enabled: true } }
    },
    access: { posts: { list: 'public', get: 'public' } },
    api: (b) => ({ hello: b.public.handler(() => 'hi') }),
  })
  return { backend, calls }
}

const listPosts = new Request('http://localhost/api/rpc/posts/list', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ json: {} }),
})
const getSession = () => new Request('http://localhost/api/auth/get-session')

test('deferAuth serves public requests without building auth', async () => {
  const { backend, calls } = counted()
  const app = await backend.start({ env: {}, deferAuth: true })
  await provision(app as never, { force: true })
  expect(calls.builds).toBe(0)
  const health = await app.handler(new Request('http://localhost/api/health'))
  expect(health.status).toBe(200)
  const hello = await app.handler(
    new Request('http://localhost/api/rpc/hello', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ json: null }),
    }),
  )
  expect(hello.status).toBe(200)
  expect(calls.builds).toBe(0)
  // A CRUD route resolves the caller even for a public list.
  expect((await app.handler(listPosts.clone())).status).toBe(200)
  expect(calls.builds).toBe(1)
  await app.close()
})

test('deferAuth builds auth once, on the first auth request', async () => {
  const { backend, calls } = counted()
  const app = await backend.start({ env: {}, deferAuth: true })
  await provision(app as never, { force: true })
  const first = await app.handler(getSession())
  expect(first.status).toBe(200)
  expect(await first.json()).toBeNull()
  await app.handler(getSession())
  expect(typeof app.auth.api.getSession).toBe('function')
  expect(calls.builds).toBe(1)
  await app.close()
})

test('deferAuth answers like eager auth for auth and session paths', async () => {
  for (const withAuthModels of [true, false]) {
    const results: unknown[] = []
    for (const deferAuth of [false, true]) {
      const { backend } = counted(withAuthModels)
      const app = await backend.start({ env: {}, deferAuth })
      await provision(app as never, { force: true })
      const session = await app.handler(getSession())
      const list = await app.handler(listPosts.clone())
      results.push([session.status, await session.text(), list.status])
      await app.close()
    }
    expect(results[1]).toEqual(results[0])
  }
})
