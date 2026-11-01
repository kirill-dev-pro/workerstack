// src/workers/context.ts — the ExecutionContext of the request a Worker is
// serving, for code that runs inside it without having it passed down: an SSR
// loader calling the API in the isolate must hand that request's waitUntil to
// the API handler, or its background work (Scheduler notify, telemetry flush)
// is cancelled when the page response ends. Server only: the registry, which
// client bundles reach, sees it through a getter the Worker registers.
import { AsyncLocalStorage } from 'node:async_hooks'

import type { ExecutionContextLike } from './types'

const current = new AsyncLocalStorage<ExecutionContextLike>()

/** Run `fn` with `ctx` as the current request's ExecutionContext. */
export function withWorkerContext<T>(
  ctx: ExecutionContextLike,
  fn: () => T,
): T {
  return current.run(ctx, fn)
}

export function currentWorkerContext(): ExecutionContextLike | undefined {
  return current.getStore()
}
