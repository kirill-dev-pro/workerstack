import { test, expect, beforeEach, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// tests/storage/lifecycle.test.ts
import type { AnyDb } from '../dialect'
import type { ResolvedBucket } from './buckets'
import type { BucketStorageRegistry } from './registry'

import { libsql } from '../database/libsql'
import { createDb } from '../db'
import { bunderstackFiles, INTERNAL_TABLES } from '../internal-tables'
import { provisionSchema } from '../provision-schema'
import { deleteStoredFile } from './delete'
import { getFileMeta, insertPendingFile, insertReadyFile } from './file-meta'
import { LocalStorageAdapter } from './local'
import { sweepOrphans } from './sweep'

let dbAny: AnyDb
let tmp: string
let adapter: LocalStorageAdapter

beforeEach(async () => {
  const { db } = await createDb(INTERNAL_TABLES, {
    url: ':memory:',
    adapter: libsql(),
  })
  await provisionSchema(db, INTERNAL_TABLES, { force: true })
  dbAny = db
  tmp = await mkdtemp(join(tmpdir(), 'bs-lifecycle-'))
  adapter = new LocalStorageAdapter(tmp)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const bytes = () => new TextEncoder().encode('data').buffer

function bucketEntry(name: string) {
  const bucket = {
    name,
    backend: { type: 'local', path: tmp },
    visibility: 'private',
    access: { create: 'authenticated', get: 'public', delete: 'owner' },
  } as ResolvedBucket
  return { bucket, adapter }
}

test('deleteStoredFile removes the object and the meta row', async () => {
  const fileId = 'files/abc.png'
  await adapter.upload(fileId, bytes(), 'image/png')
  await insertReadyFile(dbAny, {
    fileId,
    bucket: 'files',
    ownerId: 'u1',
    scopeJson: null,
    filename: 'abc.png',
    contentType: 'image/png',
    size: 4,
  })

  await deleteStoredFile(adapter, dbAny, fileId)

  expect(await adapter.exists(fileId)).toBe(false)
  expect(await getFileMeta(dbAny, fileId)).toBeNull()
})

test('sweepOrphans reaps stale pending only; ready untouched; returns count', async () => {
  const registry: BucketStorageRegistry = new Map([
    ['files', bucketEntry('files')],
  ])

  // Stale pending (object + row).
  const staleId = 'files/stale.bin'
  await adapter.upload(staleId, bytes(), 'application/octet-stream')
  await insertPendingFile(dbAny, {
    fileId: staleId,
    bucket: 'files',
    ownerId: 'u1',
    scopeJson: null,
    filename: null,
    contentType: null,
  })
  // Backdate createdAt to make it stale.
  await dbAny
    .update(bunderstackFiles)
    .set({ createdAt: 1 })
    .where(eq(bunderstackFiles.fileId, staleId))

  // Fresh ready (should survive).
  const readyId = 'files/ready.bin'
  await adapter.upload(readyId, bytes(), 'application/octet-stream')
  await insertReadyFile(dbAny, {
    fileId: readyId,
    bucket: 'files',
    ownerId: 'u1',
    scopeJson: null,
    filename: null,
    contentType: null,
    size: 4,
  })

  const reaped = await sweepOrphans(registry, dbAny, 30 * 60_000)
  expect(reaped).toBe(1)

  expect(await adapter.exists(staleId)).toBe(false)
  expect(await getFileMeta(dbAny, staleId)).toBeNull()
  expect(await adapter.exists(readyId)).toBe(true)
  expect(await getFileMeta(dbAny, readyId)).not.toBeNull()
})
