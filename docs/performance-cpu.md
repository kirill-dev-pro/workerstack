# Request CPU on Cloudflare Workers

Where a workerstack app spends CPU per request on Workers, how it was
measured, and what the `perf/request-cpu` branch changes. The subject is
airealty.global (TanStack Start on workerstack 0.2.2). In production it used
about 1.18M CPU ms a day on fetch (avg 100–125 ms, p50 65 ms, p99 461 ms) and
about 104k on Scheduler alarms (8.7k alarms a day, about 12 ms each).

## Summary

- **The fixed cost is paid once per isolate, not on every request.** Locally,
  every route costs 44–122 ms CPU on the first request of a fresh isolate and
  0.5–4 ms after that (SSR list pages about 10 ms). Production prices trivial
  routes at 50–90 ms (`/api/auth/get-session` 50–66, `recordVisit` 58–73,
  the PostHog static proxy 35–90). That only fits if most production requests
  land on a fresh isolate: a low-traffic Worker is spread over many machines,
  and each one evicts its isolate between requests. So the earlier guess, a
  35–50 ms overhead on every request, is wrong as stated. The overhead is
  real, but it is a per-isolate start that nearly every request pays.
- **The Scheduler re-armed once per fresh isolate.** Each new isolate's
  `startScheduler` sent the same `/notify` as an enqueue. That pulled the alarm
  to *now*, and the alarm that found nothing scheduled a one-second retry:
  **2 alarms per fresh isolate**, measured. That matches production's alarm
  count (8.7k/day) being close to its fetch count (9.4k/day). No job comes due
  every 10 s; the app's crons are hourly and daily.
- In a cold isolate, the framework's part of the first request was about
  **20–25 ms** of the 30–35 ms fetch-only total for an API route: building
  the hosting manifest (7 ms, unused at runtime), constructing Better Auth
  with the app's auth builder (about 10 ms, unused by public routes),
  drizzle's relational config, routers and two oRPC matchers. The rest of
  a cold SSR page (85 ms for `/`) is TanStack Start / React, plus the app's
  own wrappers.

## Method

Reproducible with `scripts/bench-cpu/` (`setup.sh` once, then `compare.sh`):

- Two local clones of the app: one with workerstack 0.2.2 from npm, one with
  this worktree's build installed as a packed tarball (`use-perf-build.sh`),
  so it resolves dependencies exactly like the npm package.
- Built with the app's own production build (`workerstack wrangler` +
  `vite build`), run with `wrangler dev` (workerd 4.149) on its
  `dist/server/wrangler.json`. A local `sqld` holds the app's migrations and
  300 synthetic agents. The env has throwaway random secrets. Bunderhost
  telemetry and the PostHog host point at a local sink, so telemetry is on
  as in production and nothing leaves the machine. No production data or
  secrets were used.
- CPU per request comes from the V8 sampling profiler over the inspector
  (`cdp-profile.ts`, 50 µs interval). For each request it starts the
  profiler, sends the request, reads the body, waits 30 ms for `waitUntil`
  work, then stops the profiler and sums sampled time outside `(idle)`.
  workerd does not report idle samples, so a parked isolate's gap is capped
  at 10 sampling intervals per sample.
- **Cold** means wrangler is restarted before each run, so the measured
  request is the first one in a new isolate. Module evaluation happens at
  startup, before the profiler attaches. Cloudflare's docs list startup as
  billed only for Dynamic Workers, so it is excluded here too. Each run then
  sends 2–4 more requests (**warm**).
- `wrangler.nosched.json` is the same config without the `SCHEDULER`
  binding. Locally the Scheduler Durable Object runs in the same isolate and
  starts its own app on the first request. In production it runs elsewhere
  and is billed as alarms, so fetch numbers use the config without it.
  `alarms.sh` counts alarms per fresh isolate with the binding present.
- `analyse.ts` maps a `.cpuprofile` back through the build's source maps to
  packages and functions (self, inclusive, top-down tree). `start-bench.ts`
  is a dependency-free regression bench in Bun: a synthetic app with auth,
  20 CRUD tables and 60 procedures, one fresh process per sample.

Local numbers are from an Apple Silicon laptop. Cloudflare's CPU-ms are of
the same order, since production trivial routes cost about what a local cold
isolate does, but compare ratios, not absolute values.

## Baseline: workerstack 0.2.2

First request of a fresh isolate, full config (Scheduler colocated, so its
app start is included), 3 runs each, then the next 4 requests:

| route | cold, ms | warm, ms |
|---|---|---|
| `GET /api/health` | 47–52 | 0.5–1 |
| `GET /api/auth/get-session` | 15–50 | 1–2 |
| `POST /api/rpc/agents/recordVisit` | 50–55 | 2–2.9 |
| `GET /api/posthog/static/surveys.js` (proxy) | 64 | 0.7–2 |
| `GET /assets/<stale>.css` (404 through SSR) | 76–82 | 2–2.9 |
| `GET /` (SSR) | 85–87 | 3–4.7 (2nd request 15) |
| `GET /agents` (SSR + DB) | 114–122 | 9–11 |

Fetch only (no Scheduler in the isolate): `/api/health` 30–33,
`get-session` 31–33, `recordVisit` 35–36.

### Where the cold milliseconds go (fetch-only `/api/health`, 30 ms)

| ms | what | owner |
|---|---|---|
| 6.9 | `backend.start()` → `inspectConfig` → `buildManifest` + `describeApiOperations` (walks every procedure) | framework |
| 5.9 | the app's auth builder (`organization()` plugin, `new Stripe()`) run by `resolveAuthConfig` | app code, called eagerly by the framework |
| 2.1 + 1.8 | `betterAuth()` construction and its async context init | framework (eager) |
| 1.6 | `drizzle({ schema })` relational config for the whole schema | framework / drizzle |
| 1.6 | CRUD router build | framework |
| 1.4 / 0.6 | oRPC `OpenAPIHandler` / `RPCHandler` matcher index | framework |
| 0.9 + 0.6 | API router merge, registry checks | framework |
| ~3 | `@sentry/cloudflare` `withSentry` wrappers (SDK inactive locally: no DSN) | app |
| rest | first execution of the request path (oRPC, valibot, libsql hrana client) | — |

`get-session` adds better-auth's own cold request path (about 8 ms of
`better-auth` self time). SSR adds TanStack Start / React rendering, which is
cold-compiled on the first render: `/` is 85 ms cold and 3–4 ms warm.

### Scheduler

| | alarms per fresh isolate (5 isolates) |
|---|---|
| 0.2.2 | 2, 2, 2, 2, 2 |
| perf branch | 1 (chain was not armed), 0, 0, 0, 0 |

A warm idle alarm cycle costs about 2 ms locally. Production's 12 ms per alarm
suggests the Scheduler's isolate is usually cold too: each alarm starts the
scheduler-role app (auth included until this branch).

## Hot spots, ranked by production impact

1. **Per-isolate app start on nearly every request** (framework). It costs
   about 20–25 ms of each cold API request, and SSR pays it too, because the
   app's `/api/health` pre-fetch (below) starts the app first.
2. **Scheduler alarms driven by fresh isolates** (framework). About 8.7k
   alarms/day × 12 ms ≈ 104k CPU ms/day, plus a DO request per isolate.
3. **SSR cold render** (TanStack Start / React / app). `/` is 85 ms and
   list pages 115–120 ms on the first render. This is the largest single
   item, but not framework code; edge caching of public pages is the lever
   (AIRealty Perf).
4. **App-side wrappers** (airealty `src/worker-entry.ts`). Every
   non-`/api` request, static asset misses and the PostHog proxy included,
   first runs an internal `/api/health` through the whole workerstack stack.
   That forces an app start and copies `bindings` per request. `withSentry`
   wraps every request. Stale `/assets/*.css` requests (2.7k a week at 93 ms)
   go through the health fetch and a full SSR 404.
5. Better Auth construction. It is deferred now; when it runs, the app's
   builder dominates (the `organization` plugin, `new Stripe()` on every
   start).

## Changes on `perf/request-cpu`

| commit | change |
|---|---|
| `perf(workers): a new isolate only re-arms a dead Scheduler alarm chain` | `startScheduler` sends `/notify` with `ensure`: it arms an alarm only if none is set and never starts the retry alarm. Enqueues and cron triggers keep the old semantics. |
| `perf(backend): build the manifest on first read, not on every start` | `inspectConfig` returns a lazy `manifest`. `start()` reads it only to check a hosted blueprint file. |
| `perf(workers): build Better Auth on first use in a Worker isolate` | `start({ deferAuth })`, set by the Workers `appFor`: the auth config builder and `betterAuth()` run on the first `/api/auth` request, session resolution or `app.auth` read. Other hosts, and apps with `openapi`, still build auth at start. |
| `perf(runtime): construct the RPC and OpenAPI handlers on first use` | each oRPC handler indexes every procedure in its constructor. |
| `perf(start): time SSR without starting the app` | `createStartWorker` timed SSR through `appFor` and so started the app on a render. A per-isolate reporter (`Platform.telemetry`) now serves both. |
| `feat(workers): worker.app(env) returns the isolate's started app` | lets an SSR entry get the app (and register the env) without an internal request. |
| `chore(bench): cold-isolate CPU benchmark for Workers apps` | `scripts/bench-cpu/`. |

Behaviour: `bun run test` passes (838 package tests, 40 script tests), with
new tests for `ensure`, deferred auth (identical responses with and without,
auth models present or absent), SSR timing without an app start, and
`worker.app`.

## Results

Cold first request of a fresh isolate, fetch only (`wrangler.nosched.json`),
CPU ms, median of 3 runs alternating between builds. Warm is the median of
the 2 requests that follow in the same isolate. The app is airealty at the
same commit; only the workerstack build differs (0.2.2 from npm vs this
branch, packed).

| route type | route | 0.2.2 cold | branch cold | Δ | 0.2.2 warm | branch warm |
|---|---|---|---|---|---|---|
| health (framework floor) | `GET /api/health` | 29.8 | 14.2 | −52% | 0.5 | 0.6 |
| auth session | `GET /api/auth/get-session` | 31.3 | 23.5 | −25% | 1.2 | 1.1 |
| API RPC | `POST /api/rpc/agents/recordVisit` | 35.1 | 18.3 | −48% | 2.2 | 2.5 |
| static proxy | `GET /api/posthog/static/surveys.js` | 47.3 | 30.3 | −36% | 1.4 | 1.4 |
| asset miss (SSR 404) | `GET /assets/styles-stale.css` | 61.7 | 44.7 | −28% | 2.2 | 2.1 |
| SSR page | `GET /` | 76.5 | 61.7 | −19% | 3.8 | 4.2 |

The Scheduler gets 2 alarms per fresh isolate on 0.2.2 and 0 on the branch
(after the first isolate re-arms a dead chain).

Synthetic app in Bun (`start-bench.ts`, median of 15 fresh processes, start
+ first request): health 20.5 → 16.0, RPC 21.6 → 12.6, get-session 23.8 →
19.4 ms. In Bun the share moved into the first request is larger, because
start-up no longer pre-warms code the request path shares with it.

### What this means for production

If, as the numbers suggest, most production requests are cold, the branch
saves roughly 15–17 ms CPU on most fetches. At 9.4k fetches a day that is
about 140–160k CPU ms a day, 12–14% of fetch CPU. Removing the
startup-driven alarms saves most of the ~104k alarm CPU ms a day. Together
that is roughly a fifth of the account's daily CPU. The rest of a cold
request is SSR rendering and app code. Cutting that further takes app-side
changes (next section).

## Not changed here: recommendations for the app

- Replace the internal `/api/health` fetch in `src/worker-entry.ts` with
  `runtime.app = await worker.app(apiBindings)` (new in this branch). It
  registers the env and starts or reuses the same app without a round trip
  through oRPC, telemetry and the API context. Prototype in a private
  clone, on top of the branch, cold ms, median of 3: PostHog proxy 29.6 →
  28.2, asset miss 43.8 → 40.6, `/` 59.6 → 54.8, `/agents` 80.1 → 76.5.
- Answer `/assets/*` misses with a plain 404 before SSR. Hashed asset names
  never render a page.
- The PostHog proxy needs only `POSTHOG_HOST`; it can read it from the
  bindings and skip the app entirely.
- Build `new Stripe()` and other plugin clients lazily inside the auth
  builder: they run on every isolate that resolves a session.
- Edge-cache public SSR pages and OG images. A cache hit costs no Worker
  CPU, and that is the only lever for the cold SSR render itself.
- `withSentry` initialises per request; measure it with the production DSN
  (it is inactive locally).

## Still open in the framework

- `drizzle({ schema })` builds the relational config for the whole schema
  on every isolate (1.6 ms for airealty).
- CRUD, storage and API routers are built eagerly (about 3 ms together).
  Building them per prefix on first match would need changes to the
  registry's collision checks, which run at start by design.
- A session lookup without a session cookie or `Authorization` header still
  constructs Better Auth. Short-circuiting it would be cheap, but plugins can
  resolve sessions from other headers, so it needs an explicit option.
