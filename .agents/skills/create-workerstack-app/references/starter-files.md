# Starter files

The smallest complete app: a public landing, email sign-in, and a private
list each user sees alone. Every file below built, passed its tests, and ran
under `workerstack dev` as written. Rename `notes` to the
product's first entity; keep the shape.

## `package.json` scripts

```json
{
  "scripts": {
    "dev": "workerstack dev",
    "build": "workerstack build",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "db:generate": "drizzle-kit generate",
    "blueprint": "workerstack blueprint",
    "blueprint:check": "workerstack blueprint --check"
  }
}
```

Dependencies come from the commands in the skill, not from a copied list, so
they resolve to current versions.

## `vite.config.ts`

`workerstack()` brings TanStack Start and the Cloudflare plugin. Add the app's own plugins (Tailwind, aliases) next to it.

```ts
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { workerstack } from 'workerstack/vite'

// workerstack() adds TanStack Start and the Cloudflare plugin: pages, API,
// jobs and realtime run in one Worker.
export default defineConfig({ plugins: [workerstack(), viteReact()] })
```

## `tsconfig.json`

`vite/client` and `bun` types: Vite env in the app, `bun:test` in tests.

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["bun", "vite/client"]
  },
  "include": ["src", "vite.config.ts", "drizzle.config.ts"]
}
```

## `drizzle.config.ts`

Used by `bun run db:generate` only; it never runs in the Worker.

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'file:./data.db' },
})
```

## `.gitignore`

Generated files stay out of git; the blueprint and `migrations/` go in.

```
node_modules
dist
.workerstack
.wrangler
.dev.vars
.env
.env.local
wrangler.json
.celld
.tanstack
src/routeTree.gen.ts
*.db
*.db-journal
uploads
```

## `src/schema.ts`

Better Auth tables, the app's tables, and Workerstack's internal tables (`export * from 'workerstack/schema'`), so committed migrations create everything the Worker needs.

```ts
import { generateTypeId, typeid } from 'workerstack'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Workerstack's own tables, so committed migrations create them for hosting.
export * from 'workerstack/schema'

/**
 * Better Auth tables. `role` drives the admin dashboard; it is never writable
 * from the browser, only from a trusted server context.
 */
export const user = sqliteTable('user', {
  id: typeid('user')
    .primaryKey()
    .$defaultFn(() => generateTypeId('user')),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' })
    .notNull()
    .default(false),
  image: text('image'),
  role: text('role', { enum: ['user', 'admin'] })
    .notNull()
    .default('user'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
})

export const session = sqliteTable('session', {
  id: typeid('session')
    .primaryKey()
    .$defaultFn(() => generateTypeId('session')),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: typeid('user')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const account = sqliteTable('account', {
  id: typeid('account')
    .primaryKey()
    .$defaultFn(() => generateTypeId('account')),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: typeid('user')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refreshTokenExpiresAt', {
    mode: 'timestamp',
  }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
})

export const verification = sqliteTable('verification', {
  id: typeid('verification')
    .primaryKey()
    .$defaultFn(() => generateTypeId('verification')),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp' }),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }),
})

/** A note belongs to the user who wrote it; access rules scope it to them. */
export const notes = sqliteTable('notes', {
  id: typeid('note')
    .primaryKey()
    .$defaultFn(() => generateTypeId('note')),
  userId: typeid('user')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})
```

## `src/workerstack.ts`

The backend. The default entry, so `package.json` needs no `workerstack.entry`. Move to `src/workerstack/` once it grows (see creating-workerstack-apps).

```ts
import * as v from 'valibot'
import { workerstack } from 'workerstack'
import { defineAccess } from 'workerstack/access'
import { libsql } from 'workerstack/libsql'

import * as schema from './schema'

export const backend = workerstack({
  schema,
  env: {
    // Bunderhost sets APP_URL in production; `workerstack dev` sets it locally.
    server: { APP_URL: v.optional(v.string(), 'http://localhost:5173') },
  },
  database: { adapter: libsql() },
  auth: ({ env }) => ({
    baseURL: env.APP_URL,
    emailAndPassword: { enabled: true },
    // Workerstack generates TypeIDs for the auth tables.
    advanced: { database: { generateId: () => false } },
  }),
  access: defineAccess(schema, {
    notes: {
      // `owner` checks a row, and a list has none yet: list what the read
      // scope allows, which is the caller's own notes.
      list: 'authenticated',
      get: 'owner',
      create: 'authenticated',
      update: 'owner',
      delete: 'owner',
      ownerColumn: 'userId',
      sortableColumns: ['createdAt'],
      defaultSort: { column: 'createdAt', order: 'desc' },
      scope: { read: (ctx) => ({ userId: ctx.user?.id ?? '__none__' }) },
    },
  }),
  realtime: true,
  rateLimit: { windowMs: 60_000, max: 300 },
  api: (o) => ({
    // Public: what the landing page shows without a session.
    stats: o.public.handler(async ({ context }) => ({
      notes: await context.db.$count(schema.notes),
    })),
  }),
})

/** Type handle only: the Worker starts the backend for each request. */
export type App = Awaited<ReturnType<typeof backend.start>>
```

## `src/api.ts`

The typed client. Not `src/client.ts`: that name is a reserved TanStack Start entry.

```ts
// src/api.ts — not src/client.ts, which is a reserved TanStack Start entry.
import { workerstackStart } from 'workerstack/start'

import type { App } from './workerstack'

export const { createQueryClient, createApi } = workerstackStart<App>()
export type Api = ReturnType<typeof createApi>
```

## `src/auth-client.ts`

```ts
import { createStartAuthClient } from 'workerstack/start-auth'

export const authClient = createStartAuthClient()
export const { signIn, signUp, signOut } = authClient
```

## `src/session.ts`

The SSR session read. A Worker has no app instance, so it asks Better Auth's endpoint with the request's cookie.

```ts
import { createServerFn } from '@tanstack/react-start'
import { createIsomorphicFetch, type SessionUser } from 'workerstack/start'

const isoFetch = createIsomorphicFetch()

/**
 * The signed-in user, read on the server with the request's cookie. A Worker
 * has no app instance to ask, so this goes through Better Auth's endpoint.
 */
export const getUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionUser | null> => {
    const res = await isoFetch('/api/auth/get-session')
    const session = (await res.json().catch(() => null)) as {
      user?: SessionUser
    } | null
    return session?.user ?? null
  },
)
```

## `src/router.tsx`

A query client per router, so per request during SSR.

```ts
import type { QueryClient } from '@tanstack/react-query'
import type { SessionUser } from 'workerstack/start'

import { createRouter } from '@tanstack/react-router'

import { createApi, createQueryClient, type Api } from './api'
import { routeTree } from './routeTree.gen'

export type RouterContext = {
  queryClient: QueryClient
  api: Api
  user: SessionUser | null
}

// One query client per router, so per request during SSR: a module-level
// client would live for the whole Worker isolate and share one user's cached
// data with the next request.
export function getRouter() {
  const queryClient = createQueryClient()
  return createRouter({
    routeTree,
    context: { queryClient, api: createApi(queryClient), user: null },
    defaultPreload: 'intent',
    scrollRestoration: true,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
```

## `src/routes/__root.tsx`

```tsx
import { QueryClientProvider } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router'

import type { RouterContext } from '../router'

import { getUser } from '../session'

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async () => ({ user: await getUser() }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Notes' },
    ],
  }),
  component: Root,
})

function Root() {
  const { queryClient } = Route.useRouteContext()
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body
        style={{ fontFamily: 'system-ui', maxWidth: 640, margin: '2rem auto' }}
      >
        <QueryClientProvider client={queryClient}>
          <Outlet />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}
```

## `src/routes/index.tsx`

Public: server-rendered with data any visitor may see.

```tsx
import { createFileRoute, Link } from '@tanstack/react-router'

// Public: rendered on the server with data any visitor may see.
export const Route = createFileRoute('/')({
  loader: ({ context }) => context.api.stats.call(),
  component: Home,
})

function Home() {
  const stats = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  return (
    <main>
      <h1>Notes</h1>
      <p>{stats.notes} notes written so far.</p>
      {user ? (
        <Link to="/notes">Your notes, {user.name}</Link>
      ) : (
        <Link to="/login">Sign in</Link>
      )}
    </main>
  )
}
```

## `src/routes/login.tsx`

```tsx
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { signIn, signUp } from '../auth-client'

export const Route = createFileRoute('/login')({ component: Login })

function Login() {
  const navigate = useNavigate()
  const router = useRouter()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [error, setError] = useState<string | null>(null)

  async function submit(form: FormData) {
    const email = String(form.get('email'))
    const password = String(form.get('password'))
    const result =
      mode === 'up'
        ? await signUp.email({
            email,
            password,
            name: String(form.get('name')),
          })
        : await signIn.email({ email, password })
    if (result.error) return setError(result.error.message ?? 'Sign-in failed')
    // The root route reads the session in beforeLoad; reload it.
    await router.invalidate()
    await navigate({ to: '/notes' })
  }

  return (
    <main>
      <h1>{mode === 'in' ? 'Sign in' : 'Create an account'}</h1>
      <form action={submit}>
        {mode === 'up' ? (
          <input name="name" placeholder="Name" required />
        ) : null}
        <input name="email" type="email" placeholder="Email" required />
        <input
          name="password"
          type="password"
          placeholder="Password"
          minLength={8}
          required
        />
        <button type="submit">
          {mode === 'in' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      <button
        type="button"
        onClick={() => setMode(mode === 'in' ? 'up' : 'in')}
      >
        {mode === 'in' ? 'Create an account instead' : 'I have an account'}
      </button>
    </main>
  )
}
```

## `src/routes/notes.tsx`

Private: the guard is UX; the access rules enforce ownership on the server.

```tsx
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'

import { signOut } from '../auth-client'

// Private: the guard is for the user; the access rules enforce it on the server.
export const Route = createFileRoute('/notes')({
  beforeLoad: ({ context }) => {
    if (!context.user) throw redirect({ to: '/login' })
  },
  loader: ({ context }) => context.api.notes.list.call({ limit: 50 }),
  component: Notes,
})

function Notes() {
  const page = Route.useLoaderData()
  const { api } = Route.useRouteContext()
  const router = useRouter()

  async function add(form: FormData) {
    await api.notes.create.call({ title: String(form.get('title')) })
    await router.invalidate()
  }

  return (
    <main>
      <h1>Your notes</h1>
      <form action={add}>
        <input name="title" placeholder="A new note" required />
        <button type="submit">Add</button>
      </form>
      <ul>
        {page.items.map((note) => (
          <li key={note.id}>
            {note.title}{' '}
            <button
              type="button"
              onClick={async () => {
                await api.notes.delete.call({ id: note.id })
                await router.invalidate()
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={async () => {
          await signOut()
          await router.invalidate()
          await router.navigate({ to: '/' })
        }}
      >
        Sign out
      </button>
    </main>
  )
}
```

## `src/workerstack.test.ts`

Owner isolation and a public read, against a pushed in-memory schema.

```ts
import { expect, test } from 'bun:test'

import { backend } from './workerstack'

test('a user sees only their own notes', async () => {
  await using t = await backend.test({ database: { schema: 'push' } })
  // signUpEmail creates real user rows, which the notes' foreign key needs;
  // mockSession only fakes a session.
  const alice = t.client(
    await t.auth.signUpEmail({
      email: 'alice@example.com',
      name: 'Alice',
      password: 'alice-password',
    }),
  )
  const bob = t.client(
    await t.auth.signUpEmail({
      email: 'bob@example.com',
      name: 'Bob',
      password: 'bob-password',
    }),
  )

  await alice.notes.create({ title: 'Alice note' })
  await bob.notes.create({ title: 'Bob note' })

  const page = await alice.notes.list({})
  expect(page.items.map((note) => note.title)).toEqual(['Alice note'])
})

test('anyone can read the note count', async () => {
  await using t = await backend.test({ database: { schema: 'push' } })
  expect(await t.client().stats()).toEqual({ notes: 0 })
})
```
