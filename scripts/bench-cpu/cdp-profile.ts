// CPU per request for a Worker under `wrangler dev --inspector-port`, measured
// with the V8 sampling profiler over the Chrome DevTools Protocol.
//
//   bun cdp-profile.ts --inspector 127.0.0.1:9230 --base http://127.0.0.1:8787 \
//     --req "GET /api/health" --req "GET /" --repeat 20 --out /tmp/prof [--label x]
//
// For each request it starts the profiler, sends the request, reads the whole
// body, waits `--settle` ms for waitUntil work, stops the profiler and sums the
// sampled time that is not `(idle)`. `(program)` and `(garbage collector)` are
// counted: Cloudflare bills them too. Profiles of the first run and the merged
// self time per function are written to --out.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Args = {
  inspector: string
  base: string
  reqs: { method: string; path: string; body?: string }[]
  repeat: number
  settle: number
  out?: string
  label: string
  interval: number
  cookie?: string
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const args: Args = {
    inspector: '127.0.0.1:9230',
    base: 'http://127.0.0.1:8787',
    reqs: [],
    repeat: 1,
    settle: 30,
    label: 'run',
    interval: 50,
  }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!
    const value = argv[++i]!
    if (key === '--inspector') args.inspector = value
    else if (key === '--base') args.base = value
    else if (key === '--req') {
      const [method, path, ...rest] = value.split(' ')
      args.reqs.push({
        method: method!,
        path: path!,
        body: rest.length ? rest.join(' ') : undefined,
      })
    } else if (key === '--repeat') args.repeat = Number(value)
    else if (key === '--settle') args.settle = Number(value)
    else if (key === '--out') args.out = value
    else if (key === '--label') args.label = value
    else if (key === '--interval') args.interval = Number(value)
    else if (key === '--cookie') args.cookie = value
    else if (key === '--wait') (args as any).wait = Number(value)
    else throw new Error(`unknown flag ${key}`)
  }
  return args
}

type Node = {
  id: number
  callFrame: {
    functionName: string
    url: string
    lineNumber: number
    columnNumber: number
  }
  hitCount?: number
  children?: number[]
}
type Profile = {
  nodes: Node[]
  startTime: number
  endTime: number
  samples: number[]
  timeDeltas: number[]
}

class Cdp {
  private id = 0
  private pending = new Map<number, (v: any) => void>()
  constructor(private ws: WebSocket) {
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data))
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)!(msg)
        this.pending.delete(msg.id)
      }
    }
  }
  static async connect(addr: string): Promise<Cdp> {
    const ws = new WebSocket(`ws://${addr}/ws`)
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve()
      ws.onerror = (e) => reject(e)
    })
    return new Cdp(ws)
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`CDP timeout ${method}`)),
        30_000,
      )
      this.pending.set(id, (msg) => {
        clearTimeout(timer)
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`))
        else resolve(msg.result)
      })
    })
  }
  close() {
    this.ws.close()
  }
}

/** Busy time in ms and self time per frame, from a sampled profile. */
function analyse(profile: Profile, intervalUs: number) {
  // workerd does not report (idle): a parked isolate leaves a gap that V8
  // charges to the sample before it. Cap a sample at 10x the interval.
  const capMs = (intervalUs * 10) / 1000
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  let busy = 0
  let idle = 0
  const self = new Map<string, number>()
  for (let i = 0; i < profile.samples.length; i++) {
    const node = byId.get(profile.samples[i]!)!
    const raw = (profile.timeDeltas[i + 1] ?? profile.timeDeltas[i] ?? 0) / 1000
    const dt = Math.min(raw, capMs)
    const name = node.callFrame.functionName || '(anonymous)'
    if (name === '(idle)') {
      idle += dt
      continue
    }
    busy += dt
    const url = node.callFrame.url.split('/').slice(-2).join('/')
    const key = `${name} ${url}:${node.callFrame.lineNumber + 1}`
    self.set(key, (self.get(key) ?? 0) + dt)
  }
  return { busy, idle, self }
}

const args = parseArgs()
const cdp = await Cdp.connect(args.inspector)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: args.interval })
if (args.out) mkdirSync(args.out, { recursive: true })

const results: Record<string, number[]> = {}
const selfTotals = new Map<string, number>()
for (let round = 0; round < args.repeat; round++) {
  for (const req of args.reqs) {
    await cdp.send('Profiler.start')
    const res = await fetch(args.base + req.path, {
      method: req.method,
      headers: {
        'user-agent': 'workerstack-cpu-bench',
        ...(args.cookie ? { cookie: args.cookie } : {}),
        ...(req.method === 'POST'
          ? { 'content-type': 'application/json' }
          : {}),
      },
      body: req.method === 'POST' ? (req.body ?? '{}') : undefined,
      redirect: 'manual',
    })
    await res.arrayBuffer()
    await new Promise((r) => setTimeout(r, args.settle))
    const { profile } = (await cdp.send('Profiler.stop')) as {
      profile: Profile
    }
    const { busy, self } = analyse(profile, args.interval)
    const key = `${req.method} ${req.path} [${res.status}]`
    ;(results[key] ??= []).push(busy)
    for (const [k, v] of self) selfTotals.set(k, (selfTotals.get(k) ?? 0) + v)
    if (args.out && round === 0) {
      const safe = req.path.replace(/[^a-z0-9]+/gi, '_')
      writeFileSync(
        join(args.out, `${args.label}-${req.method}${safe}.cpuprofile`),
        JSON.stringify(profile),
      )
    }
  }
}
cdp.close()

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}
const summary: Record<string, unknown> = {}
for (const [key, xs] of Object.entries(results)) {
  summary[key] = {
    first: +xs[0]!.toFixed(2),
    median: +median(xs).toFixed(2),
    min: +Math.min(...xs).toFixed(2),
    n: xs.length,
    series: xs.map((x) => +x.toFixed(1)),
  }
}
console.log(JSON.stringify({ label: args.label, summary }, null, 2))
const top = [...selfTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)
if (args.out) {
  writeFileSync(
    join(args.out, `${args.label}-self.txt`),
    top.map(([k, v]) => `${v.toFixed(2).padStart(9)} ms  ${k}`).join('\n') +
      '\n',
  )
  writeFileSync(
    join(args.out, `${args.label}-summary.json`),
    JSON.stringify(summary, null, 2),
  )
}

// Open keep-alive sockets and the inspector socket would hold the process.
process.exit(0)
