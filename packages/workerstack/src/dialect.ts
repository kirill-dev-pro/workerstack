// src/dialect.ts — the database is SQLite (libsql locally and on Turso).
import { is, isTable } from 'drizzle-orm'
import { SQLiteTable } from 'drizzle-orm/sqlite-core'

/** The only dialect: SQLite (libsql, Turso). Kept in the blueprint schema. */
export type Dialect = 'sqlite'

/**
 * Minimal structural view of a drizzle db. Internal modules run dynamic
 * tables (Record<string, unknown> schemas) where drizzle's generics add no
 * safety, so they accept this instead. The public surface (`app.db`, API
 * context) keeps full typing via `DbFor` in db.ts.
 */
export type AnyDb = {
  select: (...args: any[]) => any
  insert: (...args: any[]) => any
  update: (...args: any[]) => any
  delete: (...args: any[]) => any
}

/** Every table must be a SQLite table. */
export function assertSqliteSchema(schema: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(schema)) {
    if (isTable(value) && !is(value, SQLiteTable)) {
      throw new Error(
        `[workerstack] "${key}" is not a SQLite table. Define every table with drizzle-orm/sqlite-core.`,
      )
    }
  }
}
