import type { AnyRouter } from '@orpc/server'

import type { ExposedApiTables } from '../api/types'

/** Shape of the `$inferClient` phantom `workerstack` puts on the app. */
export type ClientCarrier = {
  schema: Record<string, unknown>
  access: unknown
  buckets: string
  api: AnyRouter
}

export type AnyWorkerstackApp = { $inferClient?: ClientCarrier | undefined }

export type InferCarrier<TApp extends AnyWorkerstackApp> = NonNullable<
  TApp['$inferClient']
>
export type InferSchema<TApp extends AnyWorkerstackApp> =
  InferCarrier<TApp>['schema']
export type InferBuckets<TApp extends AnyWorkerstackApp> =
  InferCarrier<TApp>['buckets']

export type InferSelect<T> = T extends { $inferSelect: infer R } ? R : never
export type InferInsert<T> = T extends { $inferInsert: infer R } ? R : never

export type InferApiRouter<TApp extends AnyWorkerstackApp> =
  InferCarrier<TApp>['api']

export type ExposedTables<
  TSchema extends Record<string, unknown>,
  TAccess = undefined,
> = ExposedApiTables<TSchema, TAccess>

export type InferTables<TApp extends AnyWorkerstackApp> = ExposedTables<
  InferSchema<TApp>,
  InferCarrier<TApp>['access']
> &
  keyof InferSchema<TApp> &
  string
