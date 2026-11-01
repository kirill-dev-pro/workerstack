// Breaks a .cpuprofile down: busy time, self time by function, inclusive time
// by function and by source file (a sample counts once per frame/file).
//   bun analyse.ts <file.cpuprofile> [--top 30] [--interval 50] [--match name]
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const [file, ...rest] = process.argv.slice(2)
let top = 30
let serverDir = ''
let by = 'pkg'
let interval = 50
const matches: string[] = []
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--top') top = Number(rest[++i])
  else if (rest[i] === '--interval') interval = Number(rest[++i])
  else if (rest[i] === '--match') matches.push(rest[++i]!)
  else if (rest[i] === '--server') serverDir = rest[++i]!
  else if (rest[i] === '--by') by = rest[++i]!
}
// Map bundle frames back to their original module through the build's source maps.
const require = createRequire(join(serverDir, '..', '..', 'package.json'))
const { TraceMap, originalPositionFor } = require('@jridgewell/trace-mapping')
const maps = new Map<string, any>()
const mapFor = (url: string) => {
  const rel = String(url).replace(/^.*?\/(assets\/[^/]+|index\.js)$/, '$1')
  if (maps.has(rel)) return maps.get(rel)
  const path = join(serverDir, rel + '.map')
  const map = existsSync(path) ? new TraceMap(readFileSync(path, 'utf8')) : null
  maps.set(rel, map)
  return map
}
const origin = (cf: any): string => {
  const map = cf.url ? mapFor(cf.url) : null
  if (!map) return cf.url ? 'bundle?' : '(native)'
  const pos = originalPositionFor(map, {
    line: cf.lineNumber + 1,
    column: cf.columnNumber,
  })
  return pos.source ?? 'bundle?'
}
const pkgOf = (src: string) => {
  const m = src.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
  if (m) return m[1]!
  if (src.startsWith('(')) return src
  return (
    'app:' +
    src
      .replace(/^.*?\/src\//, 'src/')
      .split('/')
      .slice(0, 3)
      .join('/')
  )
}
const originCache = new Map<string, string>()
const profile = JSON.parse(readFileSync(file!, 'utf8'))
type N = { id: number; callFrame: any; children?: number[] }
const nodes = new Map<number, N>(profile.nodes.map((n: N) => [n.id, n]))
const parent = new Map<number, number>()
for (const n of nodes.values())
  for (const c of n.children ?? []) parent.set(c, n.id)
const cap = (interval * 10) / 1000
const frameKey = (cf: any) =>
  `${cf.functionName || '(anonymous)'} ${String(cf.url).split('/').slice(-2).join('/')}:${cf.lineNumber + 1}`
const fileKey = (cf: any) => {
  const k = `${cf.url}:${cf.lineNumber}:${cf.columnNumber}`
  let v = originCache.get(k)
  if (v === undefined) {
    const o = origin(cf)
    v = by === 'file' ? o.replace(/^.*node_modules\//, '') : pkgOf(o)
    originCache.set(k, v)
  }
  return v
}
const self = new Map<string, number>()
const incl = new Map<string, number>()
const files = new Map<string, number>()
const selfFiles = new Map<string, number>()
let busy = 0
for (let i = 0; i < profile.samples.length; i++) {
  const leaf = nodes.get(profile.samples[i])!
  if (leaf.callFrame.functionName === '(idle)') continue
  const dt = Math.min((profile.timeDeltas[i + 1] ?? 0) / 1000, cap)
  busy += dt
  self.set(
    frameKey(leaf.callFrame),
    (self.get(frameKey(leaf.callFrame)) ?? 0) + dt,
  )
  selfFiles.set(
    fileKey(leaf.callFrame),
    (selfFiles.get(fileKey(leaf.callFrame)) ?? 0) + dt,
  )
  const seenF = new Set<string>()
  const seenM = new Set<string>()
  for (
    let id: number | undefined = leaf.id;
    id !== undefined;
    id = parent.get(id)
  ) {
    const cf = nodes.get(id)!.callFrame
    const k = frameKey(cf)
    if (!seenF.has(k)) {
      seenF.add(k)
      incl.set(k, (incl.get(k) ?? 0) + dt)
    }
    const f = fileKey(cf)
    if (!seenM.has(f)) {
      seenM.add(f)
      files.set(f, (files.get(f) ?? 0) + dt)
    }
  }
}
const show = (
  title: string,
  m: Map<string, number>,
  filter?: (k: string) => boolean,
) => {
  console.log(`\n## ${title}`)
  for (const [k, v] of [...m]
    .filter(([k]) => !filter || filter(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, top))
    console.log(`${v.toFixed(2).padStart(8)} ms  ${k}`)
}
console.log(`busy ${busy.toFixed(2)} ms`)
show('self by function', self)
show(`self by ${by}`, selfFiles)
show(`inclusive by ${by}`, files)
show(
  'inclusive by function',
  incl,
  matches.length ? (k) => matches.some((m) => k.includes(m)) : undefined,
)

// Top-down tree: `--tree <minMs>` prints frames whose inclusive time is at least minMs.
const treeAt = rest.indexOf('--tree')
if (treeAt >= 0) {
  const minMs = Number(rest[treeAt + 1] ?? 1)
  const maxDepth = Number(rest[rest.indexOf('--depth') + 1] || 40)
  const total = new Map<number, number>()
  for (let i = 0; i < profile.samples.length; i++) {
    const leaf = nodes.get(profile.samples[i])!
    if (leaf.callFrame.functionName === '(idle)') continue
    const dt = Math.min((profile.timeDeltas[i + 1] ?? 0) / 1000, cap)
    for (
      let id: number | undefined = leaf.id;
      id !== undefined;
      id = parent.get(id)
    )
      total.set(id, (total.get(id) ?? 0) + dt)
  }
  const label = (cf: any) => {
    const map = cf.url ? mapFor(cf.url) : null
    const pos = map
      ? originalPositionFor(map, {
          line: cf.lineNumber + 1,
          column: cf.columnNumber,
        })
      : null
    const src = pos?.source
      ? `${pos.source.replace(/^.*node_modules\//, '')}:${pos.line}`
      : cf.url
        ? 'bundle'
        : ''
    return `${pos?.name || cf.functionName || '(anon)'} ${src}`
  }
  console.log(`\n## tree (>= ${minMs} ms)`)
  const walk = (id: number, depth: number) => {
    const n = nodes.get(id)!
    const t = total.get(id) ?? 0
    if (t < minMs || depth > maxDepth) return
    console.log(`${' '.repeat(depth)}${t.toFixed(1)} ${label(n.callFrame)}`)
    for (const c of n.children ?? []) walk(c, depth + 1)
  }
  walk(profile.nodes[0].id, 0)
}
