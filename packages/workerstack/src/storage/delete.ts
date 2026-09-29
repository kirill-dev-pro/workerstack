// src/storage/delete.ts
import type { AnyDb } from '../dialect'
import type { StorageAdapter } from './index'

import { deleteFileMetaRow } from './file-meta'

/**
 * Delete a logical file: the object and its file-meta row. All deletion goes
 * through this helper — never inline `adapter.delete`.
 */
export async function deleteStoredFile(
  adapter: StorageAdapter,
  db: AnyDb,
  fileId: string,
): Promise<void> {
  await adapter.delete(fileId)
  await deleteFileMetaRow(db, fileId)
}
