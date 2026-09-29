---
name: creating-workerstack-apps
description: Use when working in a repository that depends on workerstack - starting or structuring the application, adding or changing oRPC procedures, bases, middleware, access rules, jobs, storage, or realtime, choosing a runtime integration, or preparing it for production.
---

# Creating Workerstack Apps

## Workflow

1. Inspect the product brief and target runtime.
2. Choose the layout from the table below.
3. For a new app, use TanStack Start with `render: ssr` (the default); an SPA
   sets `render: spa` in the blueprint. A 1.0 SaaS template is not available
   yet: start from `examples/ssr-probe` (SSR) or `examples/workers-probe`
   (SPA) in the workerstack repository.
4. Configure schema, access, auth, env, storage, jobs, realtime, and the oRPC API graph.
5. Mount the single `app.handler` integration.
6. Add committed migrations and a deployment blueprint before production.
7. Run the verification contract.

| Condition                                                                   | Layout                                                            |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Small API with short configuration                                          | `src/workerstack.ts`                                              |
| Auth, access, jobs, env, or custom oRPC procedures need independent modules | `src/workerstack/`                                                |

## Runtime decision recipe

Everything runs in one Cloudflare Worker: the API, jobs and cron (Scheduler
Durable Object), realtime (RealtimeHub), and, with `render: ssr`, the TanStack
Start pages. There is no separate API process. `workerstack()` in `vite.config`
wires the Worker entry; do not write `src/worker.ts` unless the app needs a
custom fetch handler. Loaders and server functions call the backend through
`workerstackStart<App>()` in the same isolate.

Code runs in a Worker isolate: no file system, no child processes, no native
modules, limited CPU per request. Anything that needs those (a headless
browser, native drivers, large files in memory) belongs outside the app.

Read [application structure](references/application-structure.md) before placing
the Workerstack entry, schemas, authorization, or configuration modules, and
before declaring procedures, bases, middleware, or errors.
Read [runtime integrations](references/runtime-integrations.md) before mounting
HTTP, adding a worker, or choosing a framework adapter. Read the
[verification contract](references/verification.md) after adding the app
scripts and again before handoff or deployment.
