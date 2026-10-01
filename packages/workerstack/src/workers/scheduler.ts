// src/workers/scheduler.ts — the only place background work runs in a Worker.
// One instance per app ('main'). Its alarm chain follows app.jobs.nextDueAt;
// enqueues and Cron Triggers pull the alarm earlier through /notify.
//
// An alarm starts handlers and keeps claiming while they run: work enqueued
// or coming due meanwhile starts at once instead of waiting for the slowest
// handler. Cloudflare runs one alarm at a time, so a blocking alarm would
// serialize every job behind the longest one.
import type { WorkerstackBackend } from '../backend'
import type { DurableObjectStateLike, WorkerEnv } from './types'

import { appFor, type WorkerApp } from './app'

/** Cloudflare's wall-clock cap on one alarm invocation. */
export const ALARM_WALL_MS = 15 * 60_000
/** Headroom under the cap for the last handlers to settle and the reschedule. */
export const ALARM_MARGIN_MS = 60_000
export const NOTIFY_RETRY_MS = 1_000
export const SAFETY_MS = 3_600_000
export const MIN_GAP_MS = 1_000

export interface SchedulerObject {
  fetch(request: Request): Promise<Response>
  alarm(): Promise<void>
}

export type SchedulerClass = new (
  state: DurableObjectStateLike,
  env: WorkerEnv,
) => SchedulerObject

// An explicit return type keeps the private members out of the emitted .d.ts.
export function createSchedulerClass(
  backend: WorkerstackBackend<any>,
): SchedulerClass {
  return class Scheduler {
    private notified = false
    private retried = false
    /** Set while an alarm runs: a notify then wakes its loop directly. */
    private poke: (() => void) | undefined
    /** Counts wakes, so an alarm can tell one arrived after its last pump. */
    private wakes = 0

    constructor(
      private readonly state: DurableObjectStateLike,
      private readonly env: WorkerEnv,
    ) {}

    private app(): Promise<WorkerApp> {
      // Enqueues from job handlers move this alarm directly, not via a stub.
      return appFor(backend, this.env, 'scheduler', {
        jobs: { notify: (runAt) => this.schedule(runAt) },
      })
    }

    /** Only ever moves the alarm earlier; wakes a running alarm's loop. */
    private async schedule(runAt: number) {
      this.wake()
      const current = await this.state.storage.getAlarm()
      if (current === null || runAt < current) {
        await this.state.storage.setAlarm(runAt)
      }
    }

    private wake() {
      this.wakes++
      const poke = this.poke
      this.poke = undefined
      poke?.()
    }

    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url)
      if (url.pathname !== '/notify' || request.method !== 'POST') {
        return new Response('Not found', { status: 404 })
      }
      const { runAt } = (await request.json()) as { runAt: number }
      this.notified = true
      this.retried = false
      await this.schedule(runAt)
      return new Response(null, { status: 204 })
    }

    async alarm(): Promise<void> {
      // Clear the alarm that fired, so schedule() below can set a later one.
      // Cloudflare has already cleared it; celld and the test fake may not.
      const fired = await this.state.storage.getAlarm()
      if (fired !== null && fired <= Date.now()) {
        await this.state.storage.deleteAlarm()
      }
      const app = await this.app()
      const claimUntil = Date.now() + ALARM_WALL_MS - ALARM_MARGIN_MS
      let claimed = 0
      let pokedBefore = false
      let wakesAtPump = this.wakes
      try {
        for (;;) {
          // Armed before the pump, so a notify that lands during it is seen.
          const poked = new Promise<void>((resolve) => (this.poke = resolve))
          wakesAtPump = this.wakes
          const cycle = await app.jobs.pump(Date.now(), { claimUntil })
          claimed += cycle.claimed
          if (!cycle.wake) {
            // Nothing running. Work that finished within the pump may have
            // enqueued more; stop only once a pump claims nothing.
            if (cycle.claimed > 0) continue
            break
          }
          // Handlers are running: wait for one to finish, a notify, or the
          // next due time (a delayed job, a cron slot), whichever is first.
          const now = Date.now()
          const next = await app.jobs.nextDueAt(now, now + SAFETY_MS)
          let due = next ?? now + SAFETY_MS
          // A notify the pump answered with nothing may be an enqueue whose
          // transaction has not committed yet: look again shortly.
          if (pokedBefore && cycle.claimed === 0) {
            due = Math.min(due, now + NOTIFY_RETRY_MS)
          }
          const wait = Math.max(MIN_GAP_MS, due - now)
          pokedBefore = false
          let timer: ReturnType<typeof setTimeout> | undefined
          await Promise.race([
            cycle.wake,
            poked.then(() => void (pokedBefore = true)),
            new Promise<void>((resolve) => (timer = setTimeout(resolve, wait))),
          ])
          clearTimeout(timer)
        }
      } finally {
        this.poke = undefined
      }
      const now = Date.now()
      // Notifies during the loop set alarms it has already served; drop a
      // stale one so the reschedule below can move the alarm later.
      const pending = await this.state.storage.getAlarm()
      if (pending !== null && pending <= now) {
        await this.state.storage.deleteAlarm()
      }
      // A notify after the last pump may be an enqueue not yet committed.
      if (this.wakes !== wakesAtPump) {
        await this.schedule(now + NOTIFY_RETRY_MS)
        return
      }
      // An enqueue inside a transaction notifies before its commit.
      if (this.notified && claimed === 0 && !this.retried) {
        this.retried = true
        await this.schedule(now + NOTIFY_RETRY_MS)
        return
      }
      this.notified = false
      const next = await app.jobs.nextDueAt(now, now + SAFETY_MS)
      await this.schedule(Math.max(next ?? now + SAFETY_MS, now + MIN_GAP_MS))
    }
  }
}
