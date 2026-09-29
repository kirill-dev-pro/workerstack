import { readFile } from 'node:fs/promises'

import type { WorkerstackManifest } from './manifest'

import { parseBlueprintYaml } from './blueprint'
import { diffManifests } from './manifest-diff'

export class HostedBlueprintMismatchError extends Error {
  constructor(paths: readonly { kind: string; path: string }[]) {
    super(
      '[workerstack] runtime declaration does not match the committed blueprint:\n' +
        paths.map(({ kind, path }) => `  - ${kind}: ${path}`).join('\n'),
    )
    this.name = 'HostedBlueprintMismatchError'
  }
}

export function manifestFromBlueprint(source: string): WorkerstackManifest {
  const blueprint = parseBlueprintYaml(source)
  return {
    version: blueprint.workerstack.manifestVersion,
    database: {
      dialect: blueprint.resources.database.dialect,
      migrationsDirectory: blueprint.resources.database.migrationsDirectory,
      tables: blueprint.resources.database.tables,
    },
    storage: blueprint.resources.storage,
    realtime: blueprint.resources.realtime ?? { required: false },
    messaging: blueprint.resources.messaging,
    environment: blueprint.environment.map((entry) => ({
      ...entry,
      sensitive: entry.sensitive ?? entry.scope === 'server',
    })),
    api: blueprint.api ?? { operations: [] },
    background: {
      jobs: blueprint.background.jobs,
      cron: blueprint.background.cron,
      maintenance: blueprint.background.maintenance,
    },
  }
}

export function assertManifestMatchesBlueprint(
  manifest: WorkerstackManifest,
  source: string,
): void {
  const differences = diffManifests(manifestFromBlueprint(source), manifest)
  if (differences.length > 0)
    throw new HostedBlueprintMismatchError(differences)
}

export async function assertHostedBlueprintFile(
  manifest: WorkerstackManifest,
  path: string,
): Promise<void> {
  let source: string
  try {
    source = await readFile(path, 'utf8')
  } catch {
    throw new Error(`[workerstack] hosted blueprint does not exist: ${path}`)
  }
  assertManifestMatchesBlueprint(manifest, source)
}
