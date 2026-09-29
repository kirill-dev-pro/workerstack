import type { LibSQLDatabase } from 'drizzle-orm/libsql'

import type {
  DatabaseAdapter,
  DatabaseConnection,
  DatabaseConnectionResult,
} from './database/adapter'

export type Driver = 'libsql'

/** The public db type for a schema. */
export type DbFor<TSchema extends Record<string, unknown>> =
  LibSQLDatabase<TSchema>

/** The database an application receives on `context.db` and `app.db`. */
export type WorkerstackDb<TSchema extends Record<string, unknown>> =
  DbFor<TSchema>

/** The transaction handle inside `db.transaction(...)`. */
export type WorkerstackTx<TSchema extends Record<string, unknown>> = Parameters<
  Parameters<DbFor<TSchema>['transaction']>[0]
>[0]

export async function createDb<TSchema extends Record<string, unknown>>(
  schema: TSchema,
  cfg: DatabaseConnection & { adapter: DatabaseAdapter },
): Promise<DatabaseConnectionResult<TSchema> & { driver: Driver }> {
  const result = await cfg.adapter.connect(schema, {
    url: cfg.url,
    authToken: cfg.authToken,
  })
  return { ...result, driver: cfg.adapter.driver }
}
