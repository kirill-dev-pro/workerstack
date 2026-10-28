# Changelog

## 0.2.0

- Reports errors and performance to Bunderhost when the platform supplies
  `BUNDERHOST_TELEMETRY_URL` and `BUNDERHOST_TELEMETRY_TOKEN`: unhandled
  exceptions in API procedures, failed job and cron runs on every attempt,
  SSR renders that throw, and request and job durations as window deltas.
  A Worker has no timer, so the entry flushes through `waitUntil` after each
  request and each scheduler tick. Without the variables nothing is sent.
- `app.telemetry.captureException(error, { source: 'api', … })` reports an
  error the application caught itself.

## 0.1.8

- A queue pump no longer probes every definition. It used to run a
  running-count select and a claim update per declared job and cron on every
  pass, and the scheduler pumps again each time a handler finishes, so an app
  with ten definitions spent ~20 statements per completed job even when only
  one type had work. One grouped read now snapshots due pending and running
  rows per type, and only types with due work and free capacity are claimed.
  An idle pump costs a single statement; expired-lease recovery runs only when
  a running row exists.
- `nextDueAt` reads the earliest pending `run_at` and the earliest running
  lease end in one statement instead of two.

## 0.1.7

- The job queue's claim query no longer scans finished rows. `claim()` filters
  on `type`, `status` and `run_at`, but the widest index was `(type, status)`,
  so SQLite planned the claim through `(type, run_at)` and filtered `status`
  row by row across every finished row of that type. Succeeded rows are kept
  for 24 hours, so a per-minute cron left ~1,440 of them for each claim to walk
  — on one production app a single claim read ~2,100 rows and ran 108,000 times
  a day, 98% of the database's total row reads. The new `bjq_ready`
  `(type, status, run_at)` index makes a claim read only the rows it returns,
  and covers the `(type, status)` running-count probe as a prefix, so
  `bjq_type_status` is dropped.
- The succeeded-row retention sweep no longer scans every succeeded row. It
  filters on `finished_at`, which `bjq_claim` does not carry; the new
  `bjq_reap` `(status, finished_at)` index covers it.

## 0.1.5

- Automatically installs Bunderhost managed identity when the host supplies the
  sensitive server configuration and the application has Better Auth tables.
  Set `auth.managedIdentity: false` to opt out.
- Declares managed identity capabilities in the deployment blueprint and keeps
  its credentials out of client environment access.
- Exposes dynamic providers and provider-specific sign-in through
  `createStartAuthClient().managed.providers()` and `signIn.managed(...)`.
- Publishes the shared server adapter at `workerstack/managed-auth` and the
  browser-only helper at `workerstack/managed-auth/client`.

## 0.1.4

- The new-app skill installs Uncheck, copies editable formatting defaults,
  and configures staged lint/format pre-commit hooks. Full-project checks
  include TypeScript; the hook only runs Oxlint and Oxfmt.
- The README starts with `bunx workerstack skills`, including agent discovery
  and reload guidance for creating an app from an empty directory.

## 0.1.3

- `createApiHandlers(app)` from `workerstack/start` registers `GET`, `HEAD`,
  `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS`. It registered only `GET`,
  `POST`, `PATCH`, and `DELETE`, so TanStack Start sent a `PUT` request to SSR:
  the client got 200 with HTML and the write did not run.
- Expected API errors are no longer logged as
  `[workerstack-api] 500 Internal Server Error`. The response status was
  already correct (for example 401 or 409); only the log was wrong, because
  oRPC v2 errors have no `status` field. Declared errors such as
  `errors.CONFLICT(...)` are also no longer logged as
  `Unhandled error in procedure`. Real 5xx errors are still logged.

## 0.1.2

- Jobs run side by side in the Scheduler. The alarm awaited every handler it
  claimed, and Cloudflare runs one alarm at a time, so a job enqueued while
  another ran waited for it to finish, and per-minute cron stalled for the
  length of the longest job. The alarm now keeps claiming while handlers run,
  and claims a job only if its `maxRuntime` ends before Cloudflare's 15-minute
  alarm cap.
- A cold `workerstack dev` starts. The ssr environment found the app's
  dependencies one request at a time, re-optimized on each, and stopped on a
  chunk the previous pass had deleted (`The file does not exist at
.../deps_ssr/...`). The Vite plugin now scans the app's code up front.

## 0.1.1

- `workerstack skills` works in a directory with no app yet. It loaded the
  blueprint generator, and through it the backend's optional peers, and failed
  with "Cannot find package 'better-auth'".
- `workerstack skills` also installs `create-workerstack-app`: from an empty
  directory to a live app on Bunderhost.

## 0.1.0

The first stable release of Workerstack.

- `workerstack dev` runs Vite under Node.js and needs Node.js 20 or later.
  Under Bun, miniflare's requests to workerd ignored their dispatcher and went
  to `localhost:80`, so the dev server stopped with `ConnectionRefused` on
  `__vite_plugin_cloudflare_get_export_types__`.
- `workerstack skills` also installs `migrating-to-workerstack`, which audits
  a Bunderstack 0.x app for Workers, moves its code, and cuts its hosting over
  in Bunderhost.

## 0.1.0-beta.1

- The first request in an isolate starts the Scheduler, so jobs and cron run
  on hosts that create no Cron Triggers.

## 0.1.0-beta.0

First release of Workerstack, split from the Workers rewrite of Bunderstack
(`bunderstack@1.0.0-beta.4`). Changes against that release:

- The package, CLI, imports, Vite plugin, and blueprint file are renamed to
  `workerstack` (`workerstack.blueprint.yaml`, `virtual:workerstack/backend`,
  `WORKERSTACK_*` environment variables). Internal table names stay the same.
- SQLite only (libsql locally, Turso when hosted). Postgres, PGlite, and the
  Bun database drivers are removed.
- Image transforms are removed: they need `Bun.Image`, which Workers lack.
