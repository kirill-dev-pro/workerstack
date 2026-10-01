# Code changes

Work on a branch. Commit once the verification in the last section passes.

## 1. Dependencies

```sh
bun remove bunderstack nitro
bun add --exact workerstack@<version>
bun add -d @cloudflare/vite-plugin wrangler drizzle-kit@^0.30.0
jq .peerDependencies node_modules/workerstack/package.json
```

Pin the exact version while Workerstack is in beta: `bun add workerstack`
writes a caret range. Match the peers exactly where they are pinned: every
`@orpc/*` package the app lists must be the version workerstack names (for
example `2.0.0-beta.37`), and add `@orpc/publisher` at that version when the
app uses realtime. A mismatched oRPC copy fails at runtime, not at install.

## 2. Delete what the Worker entry replaces

Delete these before the rename, so no edit lands in a file that goes away.
Remove the ones the app has:

```sh
git rm --ignore-unmatch src/server.ts src/worker.ts 'src/routes/api/$.tsx'
```

- `src/server.ts` served `dist/client` with `Bun.file`; the Worker serves assets.
- `src/worker.ts` ran `app.runWorker()`; the Scheduler Durable Object runs jobs.
- `src/routes/api/$.tsx` mounted `createApiHandlers(app)`; the Worker routes `/api`.

Delete any other route that forwarded to `app.handler` the same way.

## 3. Rename

```sh
git mv src/bunderstack src/workerstack
grep -rl bunderstack src scripts vite.config.ts drizzle.config.ts | xargs sed -i '' -E \
  -e "s#'bunderstack(/|')#'workerstack\1#g" \
  -e "s#/bunderstack(/|')#/workerstack\1#g" \
  -e "s#import \{ bunderstack \}#import { workerstack }#g" \
  -e "s#bunderstack\(\{#workerstack({#g" \
  -e "s#Bunderstack(Error|Db|Tx)#Workerstack\1#g"
grep -rn "bunderstack" src scripts | grep -v "_bunderstack_\|bunderstack_file_meta"
```

`sed -i ''` is the macOS form; on Linux use `sed -i`. The second expression
covers relative imports (`./bunderstack`, `../src/bunderstack`) and the
`~/bunderstack` alias. Review what the last command still finds. Physical
table names such as `_bunderstack_jobs` stay: they are the tables in
production.

## Older than 0.24

When `package.json` had `bunderstack` below `0.24`, the 0.24 breaking changes
come with the move (Bunderstack's `docs/MIGRATION-0.24.md` has the full list):

- `backend.manifest` becomes `backend.inspect()` (pass `{ env }` when needed).
- The `email` key becomes `messaging` with named channels:
  `app.email.send()` becomes `app.messaging.<channel>.send()`, `ctx.email`
  becomes `ctx.messaging`, `t.email.sent` becomes
  `t.messaging.<channel>.sent`. A key that only set a sender and never sent
  anything can simply go.
- The email log tables become the message journal, so `db:generate` produces
  a migration (see step 9).

## 4. Remove the app singleton

A Worker starts the backend per request. `src/workerstack/index.ts` becomes a
type handle:

```ts
import { backend } from './backend'

export { backend }

/** Type handle only: the Worker starts the backend for each request. */
export type App = Awaited<ReturnType<typeof backend.start>>
```

Then find every runtime importer of `app` and rewrite it:

```sh
grep -rnE "import \{[^}]*\bapp\b[^}]*\} from '(~|\.\.?)/(workerstack|src/workerstack)" src scripts
```

- A server function reading the session: ask Better Auth over the
  isomorphic fetch, which forwards the request's cookie in SSR.

  ```ts
  import { createServerFn } from '@tanstack/react-start'
  import { createIsomorphicFetch, type SessionUser } from 'workerstack/start'

  const isoFetch = createIsomorphicFetch()

  export const fetchUser = createServerFn({ method: 'GET' }).handler(
    async (): Promise<SessionUser | null> => {
      const res = await isoFetch('/api/auth/get-session')
      const session = (await res.json().catch(() => null)) as {
        user?: SessionUser
      } | null
      return session?.user ?? null
    },
  )
  ```

- A loader or server function using `app.db` or `app.jobs`: move the logic
  into an API procedure and call it through the typed client, which runs the
  backend in the same isolate during SSR.
- A Bun script in `scripts/` (seed, admin grant): start the backend itself and
  run against the database `workerstack dev` started, whose URL it writes to
  `.dev.vars` as `WORKERSTACK_DATABASE_URL`:

  ```ts
  import { backend } from '../src/workerstack/backend'

  const app = await backend.start()
  ```

  ```json
  "seed": "bun --env-file=.dev.vars scripts/seed.ts"
  ```

## 5. Backend declaration

In `src/workerstack/backend.ts`, remove what no longer exists:

- `transforms: true` on buckets;
- `background`, `BUNDERSTACK_ROLE`, and any worker-process settings;
- a Postgres adapter (the audit should already have stopped on it).

`storage.local` stays: it is the development store.

## 6. Vite

Replace `tanstackStart()`, nitro, and `ssr.noExternal` with `workerstack()`.
Keep the app's own plugins and aliases:

```ts
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'
import { workerstack } from 'workerstack/vite'

export default defineConfig({
  resolve: {
    alias: { '~': path.resolve(import.meta.dirname, './src') },
    tsconfigPaths: true,
  },
  plugins: [tailwindcss(), workerstack(), viteReact()],
})
```

A fixed `server.port` goes too; `workerstack dev` picks a free port and takes
`PORT` from the environment.

## 7. package.json

```json
"scripts": {
  "dev": "workerstack dev",
  "build": "workerstack build",
  "wrangler": "workerstack wrangler",
  "typecheck": "tsc --noEmit",
  "test": "bun test",
  "db:generate": "drizzle-kit generate",
  "blueprint": "workerstack blueprint",
  "blueprint:check": "workerstack blueprint --check"
},
"workerstack": { "entry": "src/workerstack/backend.ts" }
```

Remove `start`, `worker`, and the `bunderstack` key. Keep the app's other
scripts.

## 8. Ignore generated files

```
.workerstack
.wrangler
.dev.vars
wrangler.json
.celld
```

## 9. Blueprint and migrations

The schema object must include the internal tables: the Worker's jobs, cron,
idempotency, messages, and file metadata live there. If
`src/workerstack/schema/index.ts` has no `export * from 'workerstack/schema'`,
add it.

```sh
bun run blueprint
git rm bunderstack.blueprint.yaml
bun run db:generate
```

- An app from 0.24 or later that already exported the internal tables:
  `db:generate` reports no changes.
- An app that did not export them, or came from before 0.24: it generates a
  migration. Read it. Only `CREATE TABLE` and `CREATE INDEX` for the
  `_bunderstack_*` and `bunderstack_file_meta` tables is expected; commit it
  untouched.
- Anything that drops or alters an application table: stop and show the
  person. Never edit migration SQL by hand.

## 10. Tests and docs

`backend.test()` fixtures keep working under `bun test`. Delete tests that
only asserted the removed files exist. Update `AGENTS.md`, `CLAUDE.md`, and
the README: paths, commands, the blueprint name, and the documentation links
(`node_modules/workerstack/skills/`).

## Verification

```sh
bun test
bun run typecheck
bun run build
bun run blueprint:check
bun run db:generate   # no changes
bun run dev
```

In the dev app, open a public page, sign in, and do one write. A page that
renders proves the Worker starts; a sign-in and a write prove the database and
auth work.

If `workerstack dev` stops with `ConnectionRefused` on
`http://localhost/__vite_plugin_cloudflare_get_export_types__`, the installed
Workerstack is 0.1.0-beta.1, which starts Vite under Bun, where miniflare
cannot reach workerd. Later releases run Vite under Node. On beta.1, remove
`'--bun',` from the Vite command in `node_modules/workerstack/dist/dev/index.js`
(a reinstall restores the file) and run `bun run dev` again.

If a page or `/api/auth/get-session` never answers while `/api/health` does,
something awaits a fetch started by another request: look for `discoveryUrl`
or other network calls while auth initializes (see the audit).
