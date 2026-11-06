import { and, eq, inArray, lt } from 'drizzle-orm'

import type { AnyDb } from '../dialect'

import {
  workerstackMessageEvents,
  workerstackMessages,
} from '../internal-tables'

/** The journal backs the dashboard's message history and delivery tracking.
 *  Each row keeps recipients and full content, so it is not kept forever. */
export const MESSAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const REAP_INTERVAL_MS = 60 * 60_000
const REAP_BATCH = 500

// Per isolate rather than per handle: a Worker builds a new database handle
// for every request, so a per-handle mark would sweep on every write.
let lastReapAt = 0

export async function insertMessage(
  db: AnyDb | undefined,
  value: Record<string, unknown>,
) {
  if (!db) return
  await db.insert(workerstackMessages).values(value)
  await reapMessageJournal(db)
}

/**
 * Deletes journal rows older than {@link MESSAGE_RETENTION_MS}, at most once
 * an hour per isolate. Writers call it after inserting, so the journal is
 * bounded without a scheduler of its own. Events go first and explicitly:
 * SQLite enforces `ON DELETE CASCADE` only with foreign keys on. Batches are
 * selected by subquery, not bound IDs, to stay under D1's parameter limit.
 * A failure is logged and never fails the write that triggered it.
 */
export async function reapMessageJournal(db: AnyDb, now = Date.now()) {
  if (now - lastReapAt < REAP_INTERVAL_MS) return
  lastReapAt = now
  const messages = workerstackMessages
  const events = workerstackMessageEvents
  const expired = () =>
    db
      .select({ id: messages.id })
      .from(messages)
      .where(lt(messages.createdAt, now - MESSAGE_RETENTION_MS))
      .orderBy(messages.createdAt, messages.id)
      .limit(REAP_BATCH)
  try {
    for (;;) {
      await db.delete(events).where(inArray(events.messageId, expired()))
      const deleted = await db
        .delete(messages)
        .where(inArray(messages.id, expired()))
        .returning({ id: messages.id })
      if (deleted.length < REAP_BATCH) break
    }
  } catch (error) {
    console.warn('[workerstack] message journal cleanup failed:', error)
  }
}

/** Test seam: the next write sweeps again. */
export function resetMessageJournalReap() {
  lastReapAt = 0
}

export async function updateMessage(
  db: AnyDb | undefined,
  id: string,
  value: Record<string, unknown>,
  expectedStatus?: string,
) {
  if (!db) return
  const table = workerstackMessages
  await db
    .update(table)
    .set(value)
    .where(
      expectedStatus
        ? and(eq(table.id, id), eq(table.status, expectedStatus))
        : eq(table.id, id),
    )
}
