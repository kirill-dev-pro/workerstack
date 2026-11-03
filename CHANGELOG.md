# Changelog

## 0.2.7

- Security: generated CRUD from the `userId` convention is private to the
  row owner. A table with a `userId` column and no access entry used to get
  public list, get and create, so any visitor could page through it. It now
  defaults to `list: 'authenticated'` scoped to the caller's own rows,
  `get: 'owner'` and `create: 'authenticated'`; signed-out callers get 401.
  The same defaults apply to an explicit entry with an owner column that
  leaves `list`, `get` or `create` unset. Declare public reads with
  `{ list: 'public', get: 'public' }`.
- Security: the convention never exposes Better Auth plugin tables
  (`two_factor`, `passkey`, `oauth_*`, `organization`, `member`,
  `invitation`, `team*`, `apikey`, `jwks`, `device_code`, `sso_provider`,
  `wallet_address`; exported as `AUTH_PLUGIN_TABLE_NAMES`) or any table with
  a credential column (`secret`, `password`, `backupCodes`, `privateKey`, or
  a name ending in `token`). Only an explicit access entry exposes one.

## 0.2.6

- Mail from Bunderhost. `ses({ receive: true })` declares a channel that
  accepts the mail Bunderhost routes to it, and
  `jobs.inbound('<channel>', { handler })` gets each message, parsed, as a
  durable job (`InboundEmail`: sender, recipients, subject, text, HTML,
  headers, attachment metadata, `raw()`). Bunderhost delivers to
  `POST /api/_bunderstack/messaging/inbound`, signed with the secret it puts
  in `WORKERSTACK_MESSAGING_CONFIG`; a repeated delivery is a no-op, and the
  route skips the per-IP rate limit since the signature is the gate. The
  blueprint marks the channel `receive: true`, and a receiving channel needs
  exactly one handler. Tests deliver with `t.messaging.<channel>.receive()`.
- `ses()` sends through Amazon SES with one SigV4-signed request; on
  Bunderhost the key, region, configuration set and tenant come from the
  platform. Email messages take `headers` for threading, and `send()` returns
  the `Message-ID` when the provider makes it knowable.
- Hosted sends are tagged with `bunderstack_message_id` and
  `bunderhost_environment_id`, so Bunderhost can match delivery events to the
  journal.

## 0.2.5

- Telemetry the ingest turns away is no longer lost. When Bunderhost answers
  429 or 503, the window goes back into the queue and is sent with the next
  one after `Retry-After`; until then the isolate sends nothing. A crawler
  burst that starts hundreds of isolates a minute used to drop every
  refused window ("telemetry not delivered (Bunderhost answered 429)").
  Other failures still drop the window, as one may have been stored.

## 0.2.4

- An API call an SSR loader makes in the isolate keeps its background work.
  `createIsomorphicFetch` gave the Worker a `waitUntil` that dropped what it
  was handed, so the Scheduler notify of an isolate's first API call and the
  telemetry flush were cancelled when the page response ended: canceled
  Scheduler `/notify` invocations and lost telemetry windows. Worker
  handlers now carry their request's ExecutionContext to such calls. A
  custom Worker entry gets the same with `worker.withContext(ctx, fn)`;
  without it, the call waits up to 2 s for that work.

## 0.2.3

- A Worker isolate starts cheaper, and on a quiet app almost every request
  lands in a fresh one. For airealty.global the first request of an isolate
  costs half as much CPU on API routes (`/api/health` 30 → 14 ms, an RPC
  call 35 → 18 ms) and 19–36% less on SSR and proxied paths. Better Auth,
  your auth builder included, is built on the first auth request or session
  lookup, not at start (Workers only; other hosts and apps with `openapi`
  are unchanged). The hosting manifest is no longer built at start, and the
  oRPC matchers are built on first use.
- A new isolate no longer wakes the Scheduler. Each one pulled the alarm to
  now and set off a one-second retry: two alarms per isolate, about 8.7k a day
  on airealty.global. The start-up notify now only re-arms an alarm chain that
  has no alarm.
- With Bunderhost telemetry configured, `createStartWorker` times SSR without
  starting the app.
- `worker.app(env)` on `createWorker` and `createStartWorker` returns the
  isolate's started app (and registers the env), for SSR entries that used
  an internal request to get it.

## 0.2.2

- An error report carries the errors it wraps. Drizzle reports a failed query
  as "Failed query: …" and keeps the driver's error in `cause`, which was
  dropped, so Bunderhost showed the SQL but never why it failed. The `cause`
  chain now follows the stack as `Caused by:` lines; the message, and with it
  how errors group, is unchanged.

## 0.2.1

- A Worker reports what it saw before it is evicted. Telemetry left an
  isolate only once ten seconds had passed since the isolate started, so the
  first request of a fresh isolate was never sent, and an app without cron
  that gets a request now and then reported nothing at all, errors included.
  The first window of an isolate now goes out at once; later windows still
  wait ten seconds.
- An error goes out with the request that raised it instead of waiting for
  the window. An error captured while an earlier batch was still being sent
  was left in the queue when the request finished, and lost with the isolate.

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
