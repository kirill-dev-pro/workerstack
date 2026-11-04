// src/durable-objects.ts — the application's own Durable Object classes,
// declared in `workerstack({ durableObjects })`. The declaration names the
// env binding and holds the class itself; the host gets binding and class
// name through the manifest and blueprint, and Cloudflare provisions each
// class from the `exports` map rendered from them.

/** A Durable Object class: constructed by the runtime with (ctx, env). */
export type DurableObjectClass = abstract new (...args: any[]) => unknown

/**
 * One binding's class. Deleting a class destroys every object of it and its
 * data on Cloudflare, with no trash, so it is never implied by removing the
 * line: the class stays declared with `deleted: true` (and leaves the
 * Worker's exports).
 */
export type DurableObjectDeclaration =
  | DurableObjectClass
  | { class: DurableObjectClass; deleted?: boolean }

/** Keyed by env binding, e.g. `{ DOC_ROOM: DocRoom }`. */
export type DurableObjectsConfig = Record<string, DurableObjectDeclaration>

/** How the manifest and blueprint describe one declared class. */
export type DurableObjectEntry = {
  binding: string
  className: string
  deleted?: true
}

/** The Durable Objects every workerstack Worker binds; apps may not reuse them. */
export const BUILT_IN_DURABLE_OBJECTS: readonly DurableObjectEntry[] = [
  { binding: 'SCHEDULER', className: 'Scheduler' },
  { binding: 'REALTIME', className: 'RealtimeHub' },
  { binding: 'RATE_LIMITER', className: 'RateLimiter' },
]

const BINDING = /^[A-Z][A-Z0-9_]*$/
const CLASS_NAME = /^[A-Z][A-Za-z0-9_]*$/

function classOf(declaration: DurableObjectDeclaration): {
  cls: DurableObjectClass
  deleted: boolean
} {
  if (typeof declaration === 'function')
    return { cls: declaration, deleted: false }
  if (
    declaration &&
    typeof declaration === 'object' &&
    typeof declaration.class === 'function'
  )
    return { cls: declaration.class, deleted: declaration.deleted === true }
  throw new Error(
    '[workerstack] a durableObjects entry is a class, or { class, deleted: true }',
  )
}

/**
 * The declared classes as manifest entries, sorted by binding, after checking
 * names. The class name is read from the class itself, so the declaration
 * never repeats it as a string.
 */
export function describeDurableObjects(
  config: DurableObjectsConfig | undefined,
): DurableObjectEntry[] {
  const entries = Object.entries(config ?? {}).map(([binding, declaration]) => {
    const { cls, deleted } = classOf(declaration)
    const entry: DurableObjectEntry = { binding, className: cls.name }
    if (deleted) entry.deleted = true
    return entry
  })
  validateDurableObjectEntries(entries)
  return entries.sort((left, right) =>
    left.binding.localeCompare(right.binding),
  )
}

/** Name rules shared by the manifest and the blueprint parser. */
export function validateDurableObjectEntries(
  entries: readonly DurableObjectEntry[],
): void {
  const bindings = new Set<string>()
  const classes = new Set<string>()
  for (const entry of entries) {
    if (!BINDING.test(entry.binding))
      throw new Error(
        `[workerstack] Durable Object binding ${entry.binding} must be UPPER_SNAKE_CASE`,
      )
    if (!CLASS_NAME.test(entry.className))
      throw new Error(
        `[workerstack] Durable Object ${entry.binding}: class name "${entry.className}" must be a named class (class DocRoom { … })`,
      )
    const builtIn = BUILT_IN_DURABLE_OBJECTS.some(
      (other) =>
        other.binding === entry.binding || other.className === entry.className,
    )
    if (builtIn || entry.binding === 'ASSETS')
      throw new Error(
        `[workerstack] Durable Object ${entry.className} (${entry.binding}) reuses a name workerstack binds itself`,
      )
    if (entry.binding.startsWith('BUCKET_'))
      throw new Error(
        `[workerstack] Durable Object binding ${entry.binding} collides with storage bucket bindings (BUCKET_*)`,
      )
    if (bindings.has(entry.binding))
      throw new Error(
        `[workerstack] duplicate Durable Object binding "${entry.binding}"`,
      )
    if (classes.has(entry.className))
      throw new Error(
        `[workerstack] duplicate Durable Object class "${entry.className}"`,
      )
    bindings.add(entry.binding)
    classes.add(entry.className)
  }
}

/**
 * Throws when `next` drops a class `previous` declared live. Cloudflare
 * refuses such a deploy too (`provisioned_class_missing_from_config`); this
 * says it before the deploy, in the generator and on the host. Deleting a
 * class means keeping it declared with `deleted: true`.
 */
export function assertNoDroppedDurableObjects(
  previous: readonly DurableObjectEntry[] | undefined,
  next: readonly DurableObjectEntry[] | undefined,
): void {
  const now = new Set((next ?? []).map((entry) => entry.className))
  for (const entry of previous ?? []) {
    if (entry.deleted || now.has(entry.className)) continue
    throw new Error(
      `[workerstack] Durable Object ${entry.className} (${entry.binding}) was declared and is no longer; ` +
        'its objects and data still exist. Declare it again, or delete it on purpose with ' +
        `durableObjects: { ${entry.binding}: { class: ${entry.className}, deleted: true } } after removing it from the Worker's exports`,
    )
  }
}

/**
 * The live classes of a declaration keyed by binding, for the Worker entry.
 * Not by `cls.name`: a bundler renames a class whose name collides with
 * another top-level name (`DocRoom` becomes `DocRoom$1`), while an object key
 * never changes. The export name Cloudflare looks up comes from the blueprint.
 */
export function liveDurableObjectClasses(
  config: DurableObjectsConfig | undefined,
): Record<string, DurableObjectClass> {
  const classes: Record<string, DurableObjectClass> = {}
  for (const [binding, declaration] of Object.entries(config ?? {})) {
    const { cls, deleted } = classOf(declaration)
    if (!deleted) classes[binding] = cls
  }
  return classes
}
