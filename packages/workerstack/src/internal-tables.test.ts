import { test, expect, beforeAll } from 'bun:test'
import { getTableName, isTable } from 'drizzle-orm'
import {
  getTableConfig as getSqliteTableConfig,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

import { validateAndResolveAccess } from './access'
import { libsql } from './database/libsql'
import { createDb } from './db'
import {
  workerstackMessageEvents,
  workerstackMessages,
  workerstackFiles,
  workerstackIdempotency,
  workerstackJobs,
  INTERNAL_TABLES,
  INTERNAL_TABLE_NAMES,
  withInternalTables,
} from './internal-tables'
import { provisionSchema } from './provision-schema'

// --- table name resolution ---

test('workerstackFiles has table name bunderstack_file_meta', () => {
  expect(getTableName(workerstackFiles)).toBe('bunderstack_file_meta')
})

test('workerstackIdempotency has table name _bunderstack_idempotency', () => {
  expect(getTableName(workerstackIdempotency)).toBe('_bunderstack_idempotency')
})

// --- INTERNAL_TABLE_NAMES ---

test('INTERNAL_TABLE_NAMES contains every internal table name', () => {
  expect(INTERNAL_TABLE_NAMES.has('bunderstack_file_meta')).toBe(true)
  expect(INTERNAL_TABLE_NAMES.has('_bunderstack_idempotency')).toBe(true)
  expect(INTERNAL_TABLE_NAMES.has('_bunderstack_jobs')).toBe(true)
  expect(INTERNAL_TABLE_NAMES.has('_bunderstack_messages')).toBe(true)
  expect(INTERNAL_TABLE_NAMES.has('_bunderstack_message_events')).toBe(true)
  expect(INTERNAL_TABLE_NAMES.size).toBe(5)
})

// --- INTERNAL_TABLES ---

test('INTERNAL_TABLES contains both tables', () => {
  expect(isTable(INTERNAL_TABLES.workerstackFiles)).toBe(true)
  expect(isTable(INTERNAL_TABLES.workerstackIdempotency)).toBe(true)
  expect(isTable(INTERNAL_TABLES.workerstackMessages)).toBe(true)
  expect(isTable(INTERNAL_TABLES.workerstackMessageEvents)).toBe(true)
})

// --- withInternalTables ---

test('withInternalTables({}) returns object with both internal tables', () => {
  const merged = withInternalTables({})
  expect(isTable(merged.workerstackFiles)).toBe(true)
  expect(isTable(merged.workerstackIdempotency)).toBe(true)
  expect(isTable(merged.workerstackMessages)).toBe(true)
  expect(isTable(merged.workerstackMessageEvents)).toBe(true)
})

test('withInternalTables preserves user tables', () => {
  const userTable = sqliteTable('posts', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
  })
  const merged = withInternalTables({ userTable })
  expect(isTable(merged.userTable)).toBe(true)
  expect(isTable(merged.workerstackFiles)).toBe(true)
  expect(isTable(merged.workerstackIdempotency)).toBe(true)
})

test('withInternalTables dedupes re-exported internal tables', () => {
  const merged = withInternalTables({
    workerstackFiles,
    workerstackIdempotency,
  })
  expect(isTable(merged.workerstackFiles)).toBe(true)
  expect(isTable(merged.workerstackIdempotency)).toBe(true)
  expect(merged.workerstackFiles).toBe(workerstackFiles)
})

test('withInternalTables throws on foreign reserved name bunderstack_file_meta', () => {
  const clash = sqliteTable('bunderstack_file_meta', {
    id: text('id').primaryKey(),
  })
  expect(() => withInternalTables({ clash })).toThrow(
    '[workerstack] table name "bunderstack_file_meta" is reserved by workerstack',
  )
})

test('withInternalTables throws on foreign reserved name _bunderstack_idempotency', () => {
  const clash = sqliteTable('_bunderstack_idempotency', {
    key: text('key').notNull(),
    table_name: text('table_name').notNull(),
  })
  expect(() => withInternalTables({ clash })).toThrow(
    '[workerstack] table name "_bunderstack_idempotency" is reserved by workerstack',
  )
})

// --- access exclusion ---

test('validateAndResolveAccess excludes internal tables from CRUD', () => {
  const merged = withInternalTables({})
  const resolved = validateAndResolveAccess(merged)
  expect(resolved.has('workerstackFiles')).toBe(false)
  expect(resolved.has('workerstackIdempotency')).toBe(false)
  expect(resolved.has('workerstackMessages')).toBe(false)
  expect(resolved.has('workerstackMessageEvents')).toBe(false)
})

// --- provision round-trip ---

let db: Awaited<ReturnType<typeof createDb<typeof INTERNAL_TABLES>>>['db']

beforeAll(async () => {
  ;({ db } = await createDb(INTERNAL_TABLES, {
    url: ':memory:',
    adapter: libsql(),
  }))
  await provisionSchema(db, INTERNAL_TABLES, { force: true })
})

test('provision round-trip: insert+select workerstackFiles', async () => {
  const now = Date.now()
  await db.insert(workerstackFiles).values({
    fileId: 'test-file-1',
    bucket: 'uploads',
    ownerId: 'user-abc',
    status: 'pending',
    createdAt: now,
  })

  const allRows = await db.select().from(workerstackFiles)
  expect(allRows.length).toBeGreaterThan(0)
  const inserted = allRows.find((r) => r.fileId === 'test-file-1')
  expect(inserted).toBeDefined()
  expect(inserted!.bucket).toBe('uploads')
  expect(inserted!.ownerId).toBe('user-abc')
  expect(inserted!.status).toBe('pending')
  expect(inserted!.createdAt).toBe(now)
})

test('provision round-trip: insert+select workerstackIdempotency', async () => {
  const expiresAt = Date.now() + 60_000
  await db.insert(workerstackIdempotency).values({
    key: 'key-1',
    tableName: 'posts',
    bodyHash: 'abc123',
    status: 201,
    response: '{"id":1}',
    expiresAt,
  })

  const allRows = await db.select().from(workerstackIdempotency)
  expect(allRows.length).toBeGreaterThan(0)
  const inserted = allRows.find(
    (r) => r.key === 'key-1' && r.tableName === 'posts',
  )
  expect(inserted).toBeDefined()
  expect(inserted!.bodyHash).toBe('abc123')
  expect(inserted!.status).toBe(201)
  expect(inserted!.response).toBe('{"id":1}')
  expect(inserted!.expiresAt).toBe(expiresAt)
})

// --- jobs table ---

test('jobs table is registered as an internal table', () => {
  expect(getTableName(workerstackJobs)).toBe('_bunderstack_jobs')
  expect(isTable(workerstackJobs)).toBe(true)
  expect(INTERNAL_TABLE_NAMES.has('_bunderstack_jobs')).toBe(true)
})

test('jobs table indexes newest cron rows by type and runAt', () => {
  const names = getSqliteTableConfig(workerstackJobs).indexes.map(
    (entry) => entry.config.name,
  )
  expect(names).toContain('bjq_type_run_at')
})

test('withInternalTables merges the jobs table', () => {
  const merged = withInternalTables({})
  expect(isTable(merged.workerstackJobs)).toBe(true)
})

test('provision round-trip: insert+select workerstackJobs', async () => {
  const now = Date.now()
  await db.insert(workerstackJobs).values({
    id: 'job_test1',
    type: 'greet',
    payloadJson: '{}',
    status: 'pending',
    attempts: 0,
    runAt: now,
    createdAt: now,
  })

  const allRows = await db.select().from(workerstackJobs)
  const inserted = allRows.find((r) => r.id === 'job_test1')
  expect(inserted).toBeDefined()
  expect(inserted!.type).toBe('greet')
  expect(inserted!.status).toBe('pending')
  expect(inserted!.attempts).toBe(0)
})

test('message journal tables are registered', () => {
  expect(getTableName(workerstackMessages)).toBe('_bunderstack_messages')
  expect(getTableName(workerstackMessageEvents)).toBe(
    '_bunderstack_message_events',
  )
})

test('provision round-trip: insert message and provider event', async () => {
  const now = Date.now()
  await db.insert(workerstackMessages).values({
    id: 'message_test1',
    channel: 'email',
    kind: 'email',
    provider: 'resend',
    credentialSource: 'capture',
    status: 'captured',
    recipientsJson: '{"to":["user@example.com"]}',
    contentJson: '{"subject":"Welcome","text":"Hello"}',
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(workerstackMessageEvents).values({
    id: 'event_test1',
    messageId: 'message_test1',
    externalId: 'svix_test1',
    type: 'delivered',
    occurredAt: now + 1,
    createdAt: now + 2,
  })

  expect(
    await db
      .select()
      .from(workerstackMessages)
      .then((rows) => rows.find((row) => row.id === 'message_test1')),
  ).toMatchObject({
    channel: 'email',
    provider: 'resend',
    status: 'captured',
  })
  expect(
    await db
      .select()
      .from(workerstackMessageEvents)
      .then((rows) => rows.find((row) => row.id === 'event_test1')),
  ).toMatchObject({
    messageId: 'message_test1',
    externalId: 'svix_test1',
    type: 'delivered',
  })
})
