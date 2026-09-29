import { getTableName, isTable } from 'drizzle-orm'
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

export const workerstackFiles = sqliteTable(
  'bunderstack_file_meta',
  {
    fileId: text('file_id').primaryKey(),
    bucket: text('bucket').notNull(),
    ownerId: text('owner_id'),
    scopeJson: text('scope_json'),
    status: text('status').notNull(),
    filename: text('filename'),
    contentType: text('content_type'),
    size: integer('size'),
    createdAt: integer('created_at').notNull(),
    confirmedAt: integer('confirmed_at'),
  },
  (t) => [
    index('bfm_owner').on(t.ownerId),
    index('bfm_scope').on(t.bucket, t.scopeJson),
    index('bfm_sweep').on(t.status, t.createdAt),
  ],
)

export const workerstackIdempotency = sqliteTable(
  '_bunderstack_idempotency',
  {
    key: text('key').notNull(),
    tableName: text('table_name').notNull(),
    bodyHash: text('body_hash').notNull(),
    status: integer('status').notNull(),
    response: text('response').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.tableName] })],
)

export const workerstackJobs = sqliteTable(
  '_bunderstack_jobs',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull(),
    status: text('status').notNull(), // pending | running | succeeded | failed
    attempts: integer('attempts').notNull().default(0),
    runAt: integer('run_at').notNull(),
    lockedUntil: integer('locked_until'),
    dedupeKey: text('dedupe_key'),
    lastError: text('last_error'),
    createdAt: integer('created_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [
    index('bjq_claim').on(t.status, t.runAt),
    index('bjq_type_status').on(t.type, t.status),
    index('bjq_type_run_at').on(t.type, t.runAt),
    // NULL dedupe keys are distinct in both dialects, so keyless jobs never collide.
    uniqueIndex('bjq_dedupe').on(t.type, t.dedupeKey),
  ],
)

export const workerstackMessages = sqliteTable(
  '_bunderstack_messages',
  {
    id: text('id').primaryKey(),
    channel: text('channel').notNull(),
    kind: text('kind').notNull(),
    provider: text('provider').notNull(),
    credentialSource: text('credential_source').notNull(),
    providerId: text('provider_id'),
    status: text('status').notNull(),
    recipientsJson: text('recipients_json').notNull(),
    contentJson: text('content_json').notNull(),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('bmsg_created').on(t.createdAt),
    index('bmsg_channel_status').on(t.channel, t.status, t.createdAt),
    uniqueIndex('bmsg_provider_id').on(t.provider, t.providerId),
  ],
)

export const workerstackMessageEvents = sqliteTable(
  '_bunderstack_message_events',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => workerstackMessages.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    type: text('type').notNull(),
    detailJson: text('detail_json'),
    occurredAt: integer('occurred_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('bmev_external').on(t.externalId),
    index('bmev_message_time').on(t.messageId, t.occurredAt),
  ],
)

export const INTERNAL_TABLES = {
  workerstackFiles,
  workerstackIdempotency,
  workerstackJobs,
  workerstackMessages,
  workerstackMessageEvents,
} as const

export const INTERNAL_TABLE_NAMES: ReadonlySet<string> = new Set([
  'bunderstack_file_meta',
  '_bunderstack_idempotency',
  '_bunderstack_jobs',
  '_bunderstack_messages',
  '_bunderstack_message_events',
])

export function withInternalTables<TSchema extends Record<string, unknown>>(
  schema: TSchema,
): TSchema & typeof INTERNAL_TABLES {
  const merged = { ...schema } as TSchema & typeof INTERNAL_TABLES

  for (const value of Object.values(schema)) {
    if (!isTable(value)) continue
    const name = getTableName(value)
    if (!INTERNAL_TABLE_NAMES.has(name)) continue

    if (Object.values(INTERNAL_TABLES).includes(value as never)) {
      // Re-exported from workerstack/schema — already in user schema.
      continue
    }

    throw new Error(
      `[workerstack] table name "${name}" is reserved by workerstack`,
    )
  }

  for (const [key, table] of Object.entries(INTERNAL_TABLES)) {
    if (!(key in merged)) {
      ;(merged as Record<string, unknown>)[key] = table
    }
  }

  return merged
}
