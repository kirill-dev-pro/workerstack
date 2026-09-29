import { applyCommittedMigrations } from './provision-runtime'

const MIGRATIONS_REQUIRED =
  '[workerstack] No committed migrations journal was found.\n' +
  '  Production: generate migrations with `bunx drizzle-kit generate`, commit them, and keep using `workerstack/provision`.\n' +
  '  Development schema push: import provision from `workerstack/provision-schema`.'

/**
 * Apply committed migrations for a Workerstack app.
 *
 * This production entrypoint has no Drizzle Kit dependency. Development
 * schema push is deliberately isolated in `workerstack/provision-schema`.
 */
export async function provision(app: object): Promise<void> {
  if (!(await applyCommittedMigrations(app))) {
    throw new Error(MIGRATIONS_REQUIRED)
  }
}
