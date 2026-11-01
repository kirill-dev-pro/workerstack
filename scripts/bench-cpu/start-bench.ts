// Cold-start CPU of a synthetic workerstack app, one fresh Bun process per
// sample (JIT cold, like a new Worker isolate). It needs no app checkout:
//
//   bun scripts/bench-cpu/start-bench.ts [--samples 15]
//
// Each child imports the library from source, declares an app with auth
// tables, an auth builder, 20 CRUD tables and 60 custom procedures, then
// measures process CPU (user+system) for the Worker start path
// (`appFor`, which starts the app as a Worker isolate does) and for the first
// request of each kind. Bun is not workerd, so absolute numbers differ from
// Cloudflare's; the before/after ratio is what this guards.
import { spawnSync } from 'node:child_process'

const child = process.argv.includes('--child')

if (!child) {
  const samples = Number(
    process.argv[process.argv.indexOf('--samples') + 1] || 15,
  )
  const routes = ['health', 'rpc', 'session'] as const
  const rows: Record<string, number[]> = {}
  for (let i = 0; i < samples; i++) {
    for (const route of routes) {
      const run = spawnSync(
        process.execPath,
        [import.meta.path, '--child', route],
        { encoding: 'utf8' },
      )
      if (run.status !== 0) throw new Error(run.stderr || run.stdout)
      const line = run.stdout.trim().split('\n').at(-1)!
      const result = JSON.parse(line) as Record<string, number>
      for (const [key, value] of Object.entries(result))
        (rows[`${route}.${key}`] ??= []).push(value)
    }
  }
  const median = (xs: number[]) =>
    [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
  console.log('cpu ms, median of', samples, 'fresh processes')
  for (const [key, xs] of Object.entries(rows))
    console.log(`${key.padEnd(22)} ${median(xs).toFixed(2).padStart(8)}`)
  process.exit(0)
}

const route = process.argv.at(-1) as 'health' | 'rpc' | 'session'
// Dependencies resolve from the package, as the library's own imports do.
const { createRequire } = await import('node:module')
const pkg = createRequire(
  new URL('../../packages/workerstack/package.json', import.meta.url),
)
const { integer, sqliteTable, text } = (await import(
  pkg.resolve('drizzle-orm/sqlite-core')
)) as typeof import('drizzle-orm/sqlite-core')
const v = (await import(pkg.resolve('valibot'))) as typeof import('valibot')
const { workerstack } = await import('../../packages/workerstack/src/index')
const { libsql } =
  await import('../../packages/workerstack/src/database/libsql')
const { appFor } = await import('../../packages/workerstack/src/workers/app')

const stamps = () => ({
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})
const auth = {
  user: sqliteTable('user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull(),
    image: text('image'),
    ...stamps(),
  }),
  session: sqliteTable('session', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    token: text('token').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    ...stamps(),
  }),
  account: sqliteTable('account', {
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
    ...stamps(),
  }),
  verification: sqliteTable('verification', {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }),
    updatedAt: integer('updated_at', { mode: 'timestamp' }),
  }),
}
const tables: Record<string, unknown> = {}
const access: Record<string, unknown> = {}
for (let i = 0; i < 20; i++) {
  tables[`items${i}`] = sqliteTable(`items_${i}`, {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    body: text('body'),
    ownerId: text('owner_id'),
    rank: integer('rank'),
    ...stamps(),
  })
  access[`items${i}`] = {
    list: 'public',
    get: 'public',
    create: 'authenticated',
  }
}
const backend = workerstack({
  schema: { ...auth, ...tables },
  access: access as never,
  database: { adapter: libsql() },
  auth: () => ({ emailAndPassword: { enabled: true } }),
  api: (b) => {
    const procedures: Record<string, unknown> = {}
    for (let i = 0; i < 60; i++)
      procedures[`p${i}`] = b.public
        .input(v.object({ id: v.string(), n: v.optional(v.number()) }))
        .handler(({ input }) => ({ id: input.id, n: input.n ?? i }))
    return { custom: procedures } as never
  },
})

const env = {
  DATABASE_URL: ':memory:',
  AUTH_SECRET: 'bench-secret-bench-secret-bench',
}
const cpu = () => {
  const { user, system } = process.cpuUsage()
  return (user + system) / 1000
}
const ctx = { waitUntil() {} }
const t0 = cpu()
const app = await appFor(backend, env as never, 'fetch')
const t1 = cpu()
const request =
  route === 'health'
    ? new Request('http://localhost/api/health')
    : route === 'rpc'
      ? new Request('http://localhost/api/rpc/custom/p7', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ json: { id: 'x' } }),
        })
      : new Request('http://localhost/api/auth/get-session')
const response = await app.handler(request)
await response.arrayBuffer()
const t2 = cpu()
void ctx
console.log(
  JSON.stringify({
    start: t1 - t0,
    first: t2 - t1,
    total: t2 - t0,
    status: response.status,
  }),
)
