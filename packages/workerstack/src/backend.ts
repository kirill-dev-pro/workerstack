import type { AnyRouter as AnyORPCRouter } from '@orpc/server'

import type {
  SessionUserConfig,
  SessionUserExtraOf,
  TableAccessInput,
} from './access'
import type {
  BetterAuthConfig,
  WorkerstackConfig,
  RealtimeConfigInput,
} from './config'
import type { EnvConfigInput, ValidatedEnv } from './env'
import type { WorkerstackJobsBuilder, JobsDefs } from './jobs'
import type { WorkerstackManifest } from './manifest'
import type { MessagingConfig } from './messaging'
import type { Platform } from './platform'
import type { WorkerstackApp, BucketNamesOf, RuntimeOverrides } from './runtime'
import type { StorageConfigInput } from './storage/buckets'
import type { TestMethod, TestOptions } from './testing/fixture'

import { BACKEND_INTERNALS, type BackendInternals } from './backend-internals'
import { validateEnv } from './env'
import { assertHostedBlueprintFile } from './hosted-contract'
import { inspectConfig, type InspectedDefinition } from './inspect'
import { materializeWorkerstack } from './runtime'

export type StartOptions = {
  env?: Record<string, string | undefined>
  /** Host services. Missing ones use in-memory defaults. */
  platform?: Partial<Platform>
}

export type WorkerstackBackend<TApp> = {
  inspect(options?: StartOptions): WorkerstackManifest
  start(options?: StartOptions): Promise<TApp>
  test: TestMethod<TApp>
  readonly [BACKEND_INTERNALS]: BackendInternals<TApp>
}

export type WorkerstackDefinitionConfig<
  TSchema extends Record<string, unknown>,
  TAccess extends Record<string, TableAccessInput> | undefined = undefined,
  TStorage extends StorageConfigInput | undefined = undefined,
  TEnv extends EnvConfigInput | undefined = undefined,
  TJobsDefs extends JobsDefs | undefined = undefined,
  TCustomApiRouter extends AnyORPCRouter | undefined = undefined,
  TRealtime = undefined,
  TMessaging extends MessagingConfig | undefined = undefined,
  TAuthConfig extends BetterAuthConfig = BetterAuthConfig,
  TSession extends SessionUserConfig<Record<string, unknown>> | undefined =
    undefined,
> = Omit<
  WorkerstackConfig<
    TSchema,
    TAccess,
    TStorage,
    TEnv,
    TCustomApiRouter,
    TAuthConfig,
    TSession
  >,
  'realtime' | 'messaging' | 'api'
> & {
  /**
   * An inline `api` or `jobs` builder receives the open `MessagingConfig`, not
   * `TMessaging`. Naming `TMessaging` in a callback parameter makes TypeScript
   * fix it before it reads the sibling `messaging` property, and the whole
   * declaration then loses its inferred channels. Declare the builder in its
   * own module with an annotated parameter to type `ctx.messaging` exactly —
   * `defineApi({ schema, env, messaging })` and `WorkerstackJobsBuilder` both
   * take the channel record.
   */
  realtime?: TRealtime
  messaging?: TMessaging
  api?:
    | TCustomApiRouter
    | ((
        builder: import('./api/builder').WorkerstackApiBuilder<
          TSchema,
          ValidatedEnv<TEnv>,
          MessagingConfig,
          SessionUserExtraOf<TSession>
        >,
      ) => TCustomApiRouter)
  jobs?:
    | TJobsDefs
    | ((
        builder: WorkerstackJobsBuilder<
          TSchema,
          ValidatedEnv<TEnv>,
          MessagingConfig
        >,
      ) => TJobsDefs)
}

export function isWorkerstackBackend(
  value: unknown,
): value is WorkerstackBackend<unknown> {
  return (
    typeof value === 'object' && value !== null && BACKEND_INTERNALS in value
  )
}

/**
 * A configuration slot that may read validated environment values. The shape a
 * slot produces reaches the manifest, so a callback belongs here to supply a
 * key, a URL, or a sender — never to change which channels, buckets, or tables
 * exist. Blueprint generation resolves the declaration against two accepted
 * environments and rejects a shape that differs between them.
 */
export type EnvAware<TEnv extends EnvConfigInput | undefined, T> =
  | T
  | ((env: ValidatedEnv<NoInfer<TEnv>>) => T)

export type DatabaseSlot = WorkerstackConfig<
  Record<string, unknown>,
  undefined,
  undefined,
  undefined,
  undefined
>['database']

/**
 * The whole application in one object. `schema`, `access`, and the routers are
 * plain data; the slots that hold credentials also accept a function of the
 * validated environment.
 */
export type WorkerstackDeclaration<
  TSchema extends Record<string, unknown>,
  TEnv extends EnvConfigInput | undefined = undefined,
  TAccess extends Record<string, TableAccessInput> | undefined = undefined,
  TStorage extends StorageConfigInput | undefined = undefined,
  TJobsDefs extends JobsDefs | undefined = undefined,
  TCustomApiRouter extends AnyORPCRouter | undefined = undefined,
  TRealtime = undefined,
  TMessaging extends MessagingConfig | undefined = undefined,
  TAuthConfig extends BetterAuthConfig = BetterAuthConfig,
  TSession extends SessionUserConfig<Record<string, unknown>> | undefined =
    undefined,
> = Omit<
  WorkerstackDefinitionConfig<
    TSchema,
    TAccess,
    TStorage,
    TEnv,
    TJobsDefs,
    TCustomApiRouter,
    TRealtime,
    TMessaging,
    TAuthConfig,
    TSession
  >,
  'database' | 'storage' | 'messaging' | 'realtime'
> & {
  /** Declared environment. Its names reach the blueprint; its values never do. */
  env?: TEnv
  database: EnvAware<TEnv, DatabaseSlot>
  storage?: EnvAware<TEnv, TStorage>
  messaging?: EnvAware<TEnv, TMessaging>
  realtime?: EnvAware<TEnv, TRealtime>
}

export function workerstack<
  TSchema extends Record<string, unknown>,
  const TEnv extends EnvConfigInput | undefined = undefined,
  const TAccess extends Record<string, TableAccessInput> | undefined =
    undefined,
  const TStorage extends StorageConfigInput | undefined = undefined,
  const TJobsDefs extends JobsDefs | undefined = undefined,
  TCustomApiRouter extends AnyORPCRouter | undefined = undefined,
  const TRealtime extends RealtimeConfigInput | undefined = undefined,
  const TMessaging extends MessagingConfig | undefined = undefined,
  const TAuthConfig extends BetterAuthConfig = BetterAuthConfig,
  const TSession extends
    | SessionUserConfig<Record<string, unknown>>
    | undefined = undefined,
>(
  declaration: WorkerstackDeclaration<
    TSchema,
    TEnv,
    TAccess,
    TStorage,
    TJobsDefs,
    TCustomApiRouter,
    TRealtime,
    TMessaging,
    TAuthConfig,
    TSession
  >,
): WorkerstackBackend<
  WorkerstackApp<
    TSchema,
    TAccess,
    BucketNamesOf<TStorage>,
    TEnv,
    TJobsDefs,
    TCustomApiRouter,
    TRealtime,
    TMessaging,
    TAuthConfig
  >
>
export function workerstack(
  declaration: WorkerstackDeclaration<Record<string, unknown>, any>,
): WorkerstackBackend<any> {
  const { env: envSchema, ...slots } = declaration as Record<
    string,
    unknown
  > & {
    env?: EnvConfigInput
  }
  const inspect = (source: Record<string, string | undefined>) => {
    const env = validateEnv(envSchema, { source })
    const resolve = (value: unknown) =>
      typeof value === 'function'
        ? (value as (given: typeof env) => unknown)(env)
        : value
    const config = {
      ...slots,
      database: resolve(slots.database),
      storage: resolve(slots.storage),
      messaging: resolve(slots.messaging),
      realtime: resolve(slots.realtime),
    }
    return inspectConfig(config as never, envSchema, env)
  }

  type App = WorkerstackApp<any, any, any, any, any, any, any, any, any>

  const start = async (
    source: Record<string, string | undefined>,
    overrides: RuntimeOverrides = {},
    inspected: InspectedDefinition = inspect(source),
  ): Promise<App> => {
    if (source.WORKERSTACK_BLUEPRINT_PATH) {
      await assertHostedBlueprintFile(
        inspected.manifest,
        source.WORKERSTACK_BLUEPRINT_PATH,
      )
    }
    return materializeWorkerstack(
      {
        ...inspected.config,
        jobs: inspected.jobsDefs,
        api: inspected.customApiRouter,
      } as never,
      source,
      overrides,
      inspected.env,
    ) as Promise<App>
  }

  let backend: WorkerstackBackend<App>
  const test = (async (options) => {
    const testing = await import('./testing')
    return testing.createTestApp(backend, options)
  }) as TestMethod<App>
  test.configure = (options) =>
    (async (overrides: TestOptions = {}) => {
      const testing = await import('./testing')
      return testing.configureTestApp(backend, options)(overrides)
    }) as never
  backend = {
    inspect: ({ env } = {}) =>
      inspect(env ?? (process.env as Record<string, string | undefined>))
        .manifest,
    start: async ({ env, platform } = {}) =>
      await start(env ?? (process.env as Record<string, string | undefined>), {
        platform,
      }),
    test,
    [BACKEND_INTERNALS]: {
      envSchema,
      inspect,
      start,
    },
  }
  return backend
}
