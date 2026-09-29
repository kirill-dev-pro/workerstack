# workerstack

A full-stack framework for Cloudflare Workers. One declaration describes the
database, auth, API, file buckets, jobs, cron, realtime, and rate limits; the
TanStack Start app renders on the server in the same Worker.

Workerstack started as the Workers rewrite of Bunderstack. Bunderstack 0.x
stays the choice for apps that need a long-running Bun process (a headless
browser, native database drivers, large files in memory).

```sh
bun add workerstack better-auth drizzle-orm valibot @libsql/client
bun add -d vite wrangler @cloudflare/vite-plugin drizzle-kit
```

## The backend

```ts
// src/workerstack.ts
import { workerstack } from 'workerstack'
import { defineAccess } from 'workerstack/access'
import { libsql } from 'workerstack/libsql'
import * as v from 'valibot'

import * as schema from './schema'

export const backend = workerstack({
  schema,
  database: { adapter: libsql() },
  access: defineAccess(schema, {
    notes: { crud: true, list: 'authenticated', create: 'authenticated' },
  }),
  auth: ({ env }) => ({
    baseURL: env.APP_URL,
    emailAndPassword: { enabled: true },
  }),
  storage: { buckets: { media: { upload: { maxSize: '5mb' } } } },
  realtime: true,
  rateLimit: { windowMs: 60_000, max: 100 },
  jobs: (j) =>
    j.define({
      noteCreated: j.job({
        input: v.object({ noteId: v.string() }),
        handler: async (input, ctx) => {
          /* ... */
        },
      }),
      nightly: j.cron({ schedule: '0 3 * * *', handler: async () => {} }),
    }),
  api: (o) => ({
    ping: o.public
      .route({ method: 'GET', path: '/api/ping' })
      .handler(() => ({ ok: true })),
  }),
})

export type App = Awaited<ReturnType<typeof backend.start>>
```

```ts
// vite.config.ts — SSR with TanStack Start by default.
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { workerstack } from 'workerstack/vite'

export default defineConfig({ plugins: [workerstack(), viteReact()] })
```

```ts
// src/api.ts — one client for loaders, server functions, and the browser.
import { workerstackStart } from 'workerstack/start'

import type { App } from './workerstack'

export const { createQueryClient, createApi } = workerstackStart<App>()
```

On the server the client calls the backend inside the same isolate and
forwards the request cookie; in the browser it calls `/api` over HTTP.

## Commands

```sh
bunx workerstack dev        # sqld + Vite on workerd, the production runtime
bunx workerstack build      # dist/server/index.js and dist/client
bunx workerstack blueprint  # writes workerstack.blueprint.yaml
bunx workerstack wrangler   # writes wrangler.json from the blueprint
```

`workerstack.blueprint.yaml` is the single source of truth for hosting: the
database, buckets, Durable Objects (Scheduler, RealtimeHub, RateLimiter), cron,
and the Worker entry. `wrangler.json` is generated from it. Commit the
blueprint and the Drizzle migrations; a host deploys from them.

## Runtime

- Database: SQLite through libsql. Locally `workerstack dev` starts sqld;
  hosted apps use Turso.
- Files: R2 bindings, one per declared bucket.
- Jobs and cron: a Scheduler Durable Object wakes on alarms; there is no
  worker process.
- Realtime: a RealtimeHub Durable Object fans writes out to subscribers.
- Rate limits: a RateLimiter Durable Object.

Code runs in a Worker isolate: no file system, no child processes, no native
modules, and CPU time per request is limited.

## Package subpaths

- `workerstack` — `workerstack()`, the backend declaration
- `workerstack/access`, `workerstack/schema`, `workerstack/typeid`, `workerstack/env`
- `workerstack/libsql` — the database adapter
- `workerstack/vite`, `workerstack/start`, `workerstack/start-auth` — the Vite plugin and TanStack Start integration
- `workerstack/workers` — Worker entry helpers and the Durable Object classes
- `workerstack/client*`, `workerstack/query*`, `workerstack/sync`, `workerstack/live` — clients
- `workerstack/messaging`, `workerstack/email-smtp` — messaging channels
- `workerstack/testing` — `backend.test()` fixtures for `bun test`
- `workerstack/blueprint` — the blueprint schema, for hosts

## Examples

- [`examples/ssr-probe`](examples/ssr-probe) — SSR with TanStack Start
- [`examples/workers-probe`](examples/workers-probe) — SPA

## Development

```sh
bun install
bun run test            # package and repository tests
bun run test:workers    # builds the probes and runs them on celld (-- --runtime workerd for workerd)
bun run typecheck:all
```

## License

MIT
