// src/workers/index.ts — `workerstack/workers`: run an app as a Worker on
// Cloudflare or celld. See the Workers runtime spec for the binding names.
import type { WorkerstackBackend } from '../backend'
import type { ExecutionContextLike, WorkerEnv } from './types'

import { appFor, notifyScheduler } from './app'
import { currentWorkerContext, withWorkerContext } from './context'
import { RateLimiter } from './rate-limiter'
import { RealtimeHub } from './realtime-hub'
import { registerWorker, rememberWorkerEnv } from './registry'
import { createSchedulerClass } from './scheduler'

export function createWorker<TApp = any>(backend: WorkerstackBackend<TApp>) {
  // Without Cron Triggers nothing else starts the alarm chain; after the
  // first alarm the Scheduler follows app.jobs.nextDueAt on its own. Each new
  // isolate only checks that the chain is armed: on a quiet app nearly every
  // request lands in a fresh isolate, and pulling the alarm to now from each
  // of them ran an alarm (and its retry) per request.
  let schedulerStarted = false
  const startScheduler = (env: WorkerEnv, ctx: ExecutionContextLike) => {
    if (schedulerStarted || !env.SCHEDULER) return
    schedulerStarted = true
    ctx.waitUntil(
      notifyScheduler(env.SCHEDULER, Date.now(), { ensure: true }).catch(() => {
        schedulerStarted = false
      }),
    )
  }
  const handler = {
    fetch(
      request: Request,
      env: WorkerEnv,
      ctx: ExecutionContextLike,
    ): Promise<Response> {
      return withWorkerContext(ctx, async () => {
        rememberWorkerEnv(env)
        startScheduler(env, ctx)
        const app = await appFor(backend, env, 'fetch')
        try {
          const response = await app.handler(request)
          // A path that reached the Worker but has no route: let the SPA answer.
          if (response.status === 404 && env.ASSETS)
            return env.ASSETS.fetch(request)
          return response
        } finally {
          // Deltas leave the isolate between requests, never on a timer.
          if (app.telemetry.enabled) ctx.waitUntil(app.telemetry.flushIfDue())
        }
      })
    },
    async scheduled(
      _controller: unknown,
      env: WorkerEnv,
      ctx: ExecutionContextLike,
    ): Promise<void> {
      if (env.SCHEDULER)
        ctx.waitUntil(notifyScheduler(env.SCHEDULER, Date.now()))
    },
  }
  // Start server code in this isolate calls the API through it.
  registerWorker({ fetch: handler.fetch, context: currentWorkerContext })
  return {
    handler,
    startScheduler,
    /**
     * The app this isolate serves requests with, started on first call. For
     * entry code that needs it outside an `/api` request (an SSR wrapper that
     * hands `db` to loaders) without a request through the API stack.
     */
    /**
     * Run a custom entry's request with its ExecutionContext, so API calls
     * made in the isolate (SSR loaders) keep their background work alive.
     */
    withContext: withWorkerContext,
    app: (env: WorkerEnv): Promise<TApp> => {
      // Server code in this request may call the API through the Worker.
      rememberWorkerEnv(env)
      return appFor(
        backend as WorkerstackBackend<any>,
        env,
        'fetch',
      ) as Promise<TApp>
    },
    durableObjects: {
      Scheduler: createSchedulerClass(backend),
      RealtimeHub,
      RateLimiter,
    },
  }
}

export {
  createSchedulerClass,
  type SchedulerClass,
  type SchedulerObject,
} from './scheduler'
export { HubPublisher, RealtimeHub } from './realtime-hub'
export {
  registeredWorker,
  registerWorker,
  rememberWorkerEnv,
  type RegisteredWorker,
} from './registry'
export { durableRateLimitStore, RateLimiter } from './rate-limiter'
export { bucketBindingName, R2StorageAdapter } from './r2'
export type * from './types'
export { workerPlanFromBlueprint, type WorkerPlan } from '../worker-plan'
