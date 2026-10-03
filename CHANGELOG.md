# Changelog

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
