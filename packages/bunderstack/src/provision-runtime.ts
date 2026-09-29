import { access, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  PROVISION_INTERNALS,
  type WithProvisionInternals,
} from './provision-internals'

/** Create the local backing directory for a file-based url. */
export async function ensureLocalDataDir(url: string): Promise<void> {
  const match = /^file:(.+)$/.exec(url)
  if (!match) return
  const filePath = match[1]!
  if (filePath === ':memory:') return
  await mkdir(dirname(filePath), { recursive: true })
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export function getProvisionInternals(app: object) {
  const internals = (app as WithProvisionInternals)[PROVISION_INTERNALS]
  if (!internals) {
    throw new Error(
      '[bunderstack] provision() expects the app returned by bunderstack().',
    )
  }
  return internals
}

/** Apply committed migrations, returning false when no journal exists. */
export async function applyCommittedMigrations(app: object): Promise<boolean> {
  const internals = getProvisionInternals(app)
  const { db, databaseUrl, migrationsFolder, adapter } = internals
  const journal = join(migrationsFolder, 'meta', '_journal.json')
  if (!(await exists(journal))) return false

  await ensureLocalDataDir(databaseUrl)
  await adapter.migrate(db as never, migrationsFolder)
  return true
}
