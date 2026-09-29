import { expect, test } from 'bun:test'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { WorkerstackDb, WorkerstackTx } from './db'

const sqliteSchema = {
  notes: sqliteTable('notes', { id: text('id').primaryKey() }),
}

test('WorkerstackTx accepts the libSQL transaction callback parameter', () => {
  type Db = WorkerstackDb<typeof sqliteSchema>
  type Tx = WorkerstackTx<typeof sqliteSchema>

  const accepts = (db: Db) =>
    db.transaction(async (tx) => {
      const typed: Tx = tx
      return typed
    })

  expect(typeof accepts).toBe('function')
})

test('WorkerstackDb exposes the schema on its query builder', () => {
  type Db = WorkerstackDb<typeof sqliteSchema>

  const reads = (db: Db) => db.query.notes.findFirst()

  expect(typeof reads).toBe('function')
})
