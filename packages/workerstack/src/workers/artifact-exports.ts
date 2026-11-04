// Which names a built Worker module exports, read from its source: Vite and
// Rolldown end the bundle with `export { … }`. Used to check, before a deploy,
// that the Worker exports every Durable Object class the blueprint binds;
// Cloudflare refuses the deploy otherwise, and only then.
const EXPORT_LIST = /\bexport\s*\{([^}]*)\}/g
const EXPORT_DECLARATION =
  /\bexport\s+(?:const|let|var|class|function\*?|async\s+function)\s+([A-Za-z_$][\w$]*)/g

export function exportedNames(source: string): Set<string> {
  const names = new Set<string>()
  for (const [, list] of source.matchAll(EXPORT_LIST))
    for (const part of list!.split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .at(-1)
        ?.trim()
      if (name) names.add(name)
    }
  for (const [, name] of source.matchAll(EXPORT_DECLARATION)) names.add(name!)
  return names
}

/** Class names the plan binds that the built module does not export. */
export function missingDurableObjectExports(
  source: string,
  classNames: readonly string[],
): string[] {
  const names = exportedNames(source)
  return classNames.filter((name) => !names.has(name))
}
