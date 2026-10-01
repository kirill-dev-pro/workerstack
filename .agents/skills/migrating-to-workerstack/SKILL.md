---
name: migrating-to-workerstack
description: Use when an application built on Bunderstack 0.x (a `bunderstack` dependency, `bunderstack.blueprint.yaml`, a Bun server with nitro, `app.runWorker()`) should move to Workerstack or Cloudflare Workers, or when someone asks whether such an app can run on Workers, celld, or a Worker target in Bunderhost.
---

# Migrating to Workerstack

## Overview

Workerstack is not the next Bunderstack version: it runs the same backend
declaration (schema, access, auth, API, jobs, storage, realtime) inside a
Worker isolate instead of a Bun process. For a CRUD app the move is mostly
mechanical. For an app that needs a browser, native drivers, local disk, large
files in memory, or long jobs, Workers are the wrong platform, and the answer
is to say so before touching code.

The internal tables (`_bunderstack_*`, `bunderstack_file_meta`) keep their
names, so the production database carries over without a migration.

## Workflow

1. **Audit, then decide.** Run [the compatibility audit](references/compatibility-audit.md)
   on the repository and the Bunderhost project. It ends in one of three
   verdicts:
   - **Blocked**: report every blocker with its file and why Workers cannot do
     it, recommend staying on Bunderstack 0.x, and stop. Do not start a
     partial migration.
   - **Rework**: list what has to be redesigned (for example local files to a
     bucket, SMTP to an HTTP provider) and get the person's agreement before
     continuing.
   - **Go**: continue.
2. **Move the code** on a branch, following [code changes](references/code-changes.md).
   Never on the default branch: when the project deploys on push, a Worker
   blueprint there deploys at once.
3. **Verify**: `bun test`, `bun run typecheck`, `bun run build`,
   `bun run blueprint:check`, and `bun run db:generate` reporting no changes.
   Then open the app under `workerstack dev`.
4. **Cut over the hosting** with [hosting cutover](references/hosting-cutover.md).
   The target switch, the file copy, and the deployment each need the
   person's explicit confirmation.

## Quick reference

| Bunderstack 0.x                                           | Workerstack                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| `bunderstack`, `bunderstack/*`                            | `workerstack`, `workerstack/*`                                |
| `bunderstack({...})`, `BunderstackError`, `BunderstackDb` | `workerstack({...})`, `WorkerstackError`, `WorkerstackDb`     |
| `src/bunderstack/`                                        | `src/workerstack/`                                            |
| `bunderstack.blueprint.yaml` (version 1)                  | `workerstack.blueprint.yaml` (version 2); delete the old file |
| `package.json#bunderstack.entry`                          | `package.json#workerstack.entry`                              |
| `tanstackStart()`, nitro, `ssr.noExternal`                | `workerstack()` in `vite.config.ts`                           |
| `src/server.ts`, `src/worker.ts`, `src/routes/api/$.tsx`  | deleted: the package Worker entry serves them                 |
| `export const app = await backend.start()`                | `export type App = Awaited<ReturnType<typeof backend.start>>` |
| `getSessionUser(app, request)`                            | `createIsomorphicFetch()('/api/auth/get-session')`            |
| `transforms: true` on a bucket                            | removed (it needed `Bun.Image`)                               |
| `bun --bun vite dev`, `vite build`                        | `workerstack dev`, `workerstack build`                        |
| drizzle-kit 0.31                                          | drizzle-kit 0.30                                              |

## Common mistakes

- Migrating an app with a blocker "to see how far it gets". The audit verdict
  is the deliverable; a half-moved app helps nobody.
- Keeping `bunderstack.blueprint.yaml` next to the new blueprint. Bunderhost
  then has two contracts to choose from.
- Leaving any runtime import of `app`. A Worker has no app singleton; only
  `import type { App }` may remain.
- Merging before the target is switched. On a Fly project the push deploy
  fails with "Worker applications require a self-hosted VPS or Cloudflare
  target".
- Copying files by hand for a move to Cloudflare. Bunderhost copies the
  Tigris bucket into R2 during the deploy; only a server target needs the
  manual copy.
- Forgetting that the hostname changes with the target: OAuth callback URLs,
  webhooks, and links in docs point at the old one.
