// src/workers/index.ts — `workerstack/workers`: run an app as a Worker on
// Cloudflare or celld. See the Workers runtime spec for the binding names.
import type { WorkerstackBackend } from '../backend'
import type { ExecutionContextLike, WorkerEnv } from './types'

import { appFor, notifyScheduler } from './app'
import { RateLimiter } from './rate-limiter'
import { RealtimeHub } from './realtime-hub'
import { registerWorker, rememberWorkerEnv } from './registry'
import { createSchedulerClass } from './scheduler'

export function createWorker(backend: WorkerstackBackend<any>) {
  // Without Cron Triggers nothing else starts the alarm chain; after the
  // first alarm the Scheduler follows app.jobs.nextDueAt on its own.
  let schedulerStarted = false
  const startScheduler = (env: WorkerEnv, ctx: ExecutionContextLike) => {
    if (schedulerStarted || !env.SCHEDULER) return
    schedulerStarted = true
    ctx.waitUntil(
      notifyScheduler(env.SCHEDULER, Date.now()).catch(() => {
        schedulerStarted = false
      }),
    )
  }
  const handler = {
    async fetch(
      request: Request,
      env: WorkerEnv,
      ctx: ExecutionContextLike,
    ): Promise<Response> {
      rememberWorkerEnv(env)
      startScheduler(env, ctx)
      const app = await appFor(backend, env, 'fetch')
      const response = await app.handler(request)
      // A path that reached the Worker but has no route: let the SPA answer.
      if (response.status === 404 && env.ASSETS)
        return env.ASSETS.fetch(request)
      return response
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
  registerWorker(handler)
  return {
    handler,
    startScheduler,
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
