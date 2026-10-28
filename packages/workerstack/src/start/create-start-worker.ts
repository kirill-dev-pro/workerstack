// src/start/create-start-worker.ts — one Worker for a TanStack Start app:
// /api/* to workerstack, every other path to Start SSR, cron to the Scheduler.
import type { WorkerstackBackend } from '../backend'
import type { ExecutionContextLike, WorkerEnv } from '../workers/types'

import { appFor } from '../workers/app'
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

export function createStartWorker(
  backend: WorkerstackBackend<any>,
  startHandler?: StartHandler,
) {
  const worker = createWorker(backend)
  let start = startHandler
  const handler = {
    async fetch(
      request: Request,
      env: WorkerEnv,
      ctx: ExecutionContextLike,
    ): Promise<Response> {
      // SSR code in this request calls the API through the registered Worker.
      rememberWorkerEnv(env)
      worker.startScheduler(env, ctx)
      if (new URL(request.url).pathname.startsWith('/api/')) {
        return worker.handler.fetch(request, env, ctx)
      }
      start ??= await defaultStartHandler()
      // Without the platform's variables a render never starts the app: the
      // SSR path must stay as cheap as it was.
      if (!env.BUNDERHOST_TELEMETRY_URL || !env.BUNDERHOST_TELEMETRY_TOKEN)
        return start(request)
      const app = await appFor(backend, env, 'fetch')
      if (!app.telemetry.enabled) return start(request)
      // SSR is timed per normalized path and a thrown render is an error.
      const startedAt = performance.now()
      let status = 200
      try {
        const response = await start(request)
        status = response.status
        return response
      } catch (error) {
        status = 500
        app.telemetry.captureException(error, {
          source: 'http',
          method: request.method,
          path: new URL(request.url).pathname,
        })
        throw error
      } finally {
        app.telemetry.recordRequest({
          route: `ssr ${normalizePath(request.url)}`,
          status,
          durationMs: performance.now() - startedAt,
        })
        ctx.waitUntil(app.telemetry.flushIfDue())
      }
    },
    scheduled: worker.handler.scheduled,
  }
  return { handler, durableObjects: worker.durableObjects }
}

async function defaultStartHandler(): Promise<StartHandler> {
  const { createStartHandler, defaultStreamHandler } =
    await import('@tanstack/react-start/server')
  return createStartHandler(defaultStreamHandler) as StartHandler
}
