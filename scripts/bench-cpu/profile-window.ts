// Profile everything the isolate does for --ms milliseconds after a trigger URL.
const [trigger, ms, out] = process.argv.slice(2)
const ws = new WebSocket('ws://127.0.0.1:9230/ws')
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map<number, (v: any) => void>()
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data))
  pending.get(m.id)?.(m.result)
  pending.delete(m.id)
}
const send = (method: string, params = {}) =>
  new Promise<any>((r) => {
    pending.set(++id, r)
    ws.send(JSON.stringify({ id, method, params }))
  })
await send('Profiler.enable')
await send('Profiler.setSamplingInterval', { interval: 50 })
await send('Profiler.start')
await fetch(trigger!).then((r) => r.arrayBuffer())
await new Promise((r) => setTimeout(r, Number(ms)))
const { profile } = await send('Profiler.stop')
await Bun.write(out!, JSON.stringify(profile))
ws.close()
