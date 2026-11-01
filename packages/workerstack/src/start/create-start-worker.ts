// src/start/create-start-worker.ts — one Worker for a TanStack Start app:
// /api/* to workerstack, every other path to Start SSR, cron to the Scheduler.
import type { WorkerstackBackend } from '../backend'
import type { ExecutionContextLike, WorkerEnv } from '../workers/types'

import { workerTelemetry } from '../workers/app'
import { withWorkerContext } from '../workers/context'
import { createWorker } from '../workers/index'
import { rememberWorkerEnv } from '../workers/registry'

/** `/projects/42/tasks/01HX…` → `/projects/:id/tasks/:id`, as Bunderhost labels pages. */
export function normalizePath(url: string): string {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    pathname = '/'
  }
  const normalized = pathname
    .split('/')
    .map((segment) => {
      if (!segment) return segment
      if (/^\d+$/.test(segment)) return ':id'
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          segment,
        )
      )
        return ':id'
      if (/^[a-z]+_[0-9a-hjkmnp-tv-z]{26}$/.test(segment)) return ':id'
      if (/^[0-9a-f]{16,}$/i.test(segment)) return ':id'
      if (segment.length > 24) return ':id'
      return segment
    })
    .join('/')
  return normalized || '/'
}

type StartHandler = (request: Request) => Promise<Response>

export function createStartWorker<TApp = any>(
  backend: WorkerstackBackend<TApp>,
  startHandler?: StartHandler,
) {
  const worker = createWorker(backend)
  let start = startHandler
  const serve = async (
    request: Request,
    env: WorkerEnv,
    ctx: ExecutionContextLike,
  ): Promise<Response> => {
    // SSR code in this request calls the API through the registered Worker.
    rememberWorkerEnv(env)
    worker.startScheduler(env, ctx)
    if (new URL(request.url).pathname.startsWith('/api/')) {
      return worker.handler.fetch(request, env, ctx)
    }
    start ??= await defaultStartHandler()
    // A render never starts the app on its own: it is timed through the
    // isolate's reporter, which the app shares once something starts it.
    const telemetry = workerTelemetry(env)
    if (!telemetry) return start(request)
    // SSR is timed per normalized path and a thrown render is an error.
    const startedAt = performance.now()
    let status = 200
    try {
      const response = await start(request)
      status = response.status
      return response
    } catch (error) {
      status = 500
      telemetry.captureException(error, {
        source: 'http',
        method: request.method,
        path: new URL(request.url).pathname,
      })
      throw error
    } finally {
      telemetry.recordRequest({
        route: `ssr ${normalizePath(request.url)}`,
        status,
        durationMs: performance.now() - startedAt,
      })
      ctx.waitUntil(telemetry.flushIfDue())
    }
  }
  const handler = {
    fetch(
      request: Request,
      env: WorkerEnv,
      ctx: ExecutionContextLike,
    ): Promise<Response> {
      // Loaders that call the API in the isolate run inside this request.
      return withWorkerContext(ctx, () => serve(request, env, ctx))
    },
    scheduled: worker.handler.scheduled,
  }
  return {
    handler,
    app: worker.app,
    withContext: worker.withContext,
    durableObjects: worker.durableObjects,
  }
}

async function defaultStartHandler(): Promise<StartHandler> {
  const { createStartHandler, defaultStreamHandler } =
    await import('@tanstack/react-start/server')
  return createStartHandler(defaultStreamHandler) as StartHandler
}
