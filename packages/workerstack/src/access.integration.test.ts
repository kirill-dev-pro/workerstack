import { test, expect, beforeAll } from 'bun:test'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'

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

const backend = workerstack({
  schema,
  database: { url: ':memory:', adapter: libsql() },
  auth: {},
})
type App = Awaited<ReturnType<typeof backend.start>>
let app: App

beforeAll(async () => {
  app = await backend.start()
  await provision(app, { force: true })
})

test('auth tables are not exposed via auto-CRUD', async () => {
  const res = await app.handler(new Request('http://localhost/api/user'))
  expect(res.status).toBe(404)
})

test('convention CRUD on a userId table needs a signed-in caller', async () => {
  const res = await app.handler(
    new Request('http://localhost/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hello' }),
    }),
  )
  expect(res.status).toBe(401)
  const list = await app.handler(new Request('http://localhost/api/posts'))
  expect(list.status).toBe(401)
})

test('convention CRUD on a userId table shows each caller only their own rows', async () => {
  const twoFactor = sqliteTable('two_factor', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
  })
  const vpnKeys = sqliteTable('vpn_keys', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    proxyToken: text('proxy_token'),
  })
  const owned = await workerstack({
    schema: { ...schema, twoFactor, vpnKeys },
    database: { url: ':memory:', adapter: libsql() },
    authResolver: {
      api: {
        getSession: async ({ headers }) => {
          const id = headers.get('x-user')
          return id ? { user: { id, email: `${id}@example.com` } } : null
        },
      },
    },
  }).start()
  await provision(owned, { force: true })
  const call = (path: string, user?: string, init: RequestInit = {}) =>
    owned.handler(
      new Request(`http://localhost${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(user ? { 'x-user': user } : {}),
        },
      }),
    )

  const created = await call('/api/posts', 'u1', {
    method: 'POST',
    body: JSON.stringify({ title: 'Mine', userId: 'u2' }),
  })
  expect(created.status).toBe(201)
  const post = (await created.json()) as { id: number; userId: string }
  expect(post.userId).toBe('u1')

  const mine = (await (await call('/api/posts', 'u1')).json()) as {
    items: unknown[]
  }
  expect(mine.items).toHaveLength(1)
  const theirs = (await (await call('/api/posts', 'u2')).json()) as {
    items: unknown[]
  }
  expect(theirs.items).toHaveLength(0)
  expect((await call(`/api/posts/${post.id}`, 'u1')).status).toBe(200)
  expect([403, 404]).toContain(
    (await call(`/api/posts/${post.id}`, 'u2')).status,
  )
  expect((await call(`/api/posts/${post.id}`)).status).toBe(401)

  // Auth plugin tables and tables with credential columns get no routes.
  expect((await call('/api/two_factor', 'u1')).status).toBe(404)
  expect((await call('/api/vpn_keys', 'u1')).status).toBe(404)
  await owned.close()
})

test('uses an application-provided session resolver for CRUD access', async () => {
  const appWithApplicationAuth = await workerstack({
    schema,
    database: { url: ':memory:', adapter: libsql() },
    access: { posts: { list: 'authenticated' } },
    authResolver: {
      api: {
        getSession: async ({ headers }) =>
          headers.get('x-application-session')
            ? {
                user: {
                  id: 'application-user',
                  email: 'user@example.com',
                },
              }
            : null,
      },
    },
  }).start()
  await provision(appWithApplicationAuth, { force: true })

  const response = await appWithApplicationAuth.handler(
    new Request('http://localhost/api/posts', {
      headers: { 'x-application-session': 'present' },
    }),
  )

  expect(response.status).toBe(200)
  await appWithApplicationAuth.close()
})
