#!/usr/bin/env bun
// Runs examples/doc-room under `workerstack dev` and checks the DocRoom
// recipe end to end: a signed-out upgrade is refused, two signed-in sockets
// on one document reach each other, and a socket on another document does
// not. Not part of `bun run test`: it starts sqld, Vite and workerd.
//
//   bun scripts/doc-room-dev.ts            # starts dev itself
//   DOC_ROOM_URL=http://localhost:5391 bun scripts/doc-room-dev.ts
import { createServer } from 'node:net'
import { join } from 'node:path'

const example = join(import.meta.dir, '../examples/doc-room')

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      )
    })
  })
}

let dev: ReturnType<typeof Bun.spawn> | undefined
let base = process.env.DOC_ROOM_URL
if (!base) {
  const port = await freePort()
  base = `http://localhost:${port}`
  dev = Bun.spawn(
    [
      'bun',
      '../../packages/workerstack/src/cli.ts',
      'dev',
      '.',
      '--port',
      String(port),
    ],
    { cwd: example, stdout: 'inherit', stderr: 'inherit' },
  )
}

async function waitForHealth() {
  const deadline = Date.now() + 120_000
  for (;;) {
    const ok = await fetch(`${base}/api/health`)
      .then((response) => response.ok)
      .catch(() => false)
    if (ok) return
    if (Date.now() > deadline) throw new Error('dev did not answer /api/health')
    await Bun.sleep(500)
  }
}

async function signUp(email: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base! },
    body: JSON.stringify({ email, password: 'password-123', name: email }),
  })
  if (!response.ok)
    throw new Error(`sign-up ${response.status}: ${await response.text()}`)
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

type Socket = { socket: WebSocket; messages: unknown[] }

function open(doc: string, cookie?: string): Promise<Socket> {
  const url = `${base!.replace(/^http/, 'ws')}/api/docs/${doc}/room`
  const socket = new WebSocket(url, {
    headers: cookie ? { cookie } : {},
  } as never)
  const messages: unknown[] = []
  socket.addEventListener('message', (event) =>
    messages.push(JSON.parse(String(event.data))),
  )
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve({ socket, messages }))
    socket.addEventListener('error', () => reject(new Error('refused')))
  })
}

async function until(what: string, check: () => boolean) {
  const deadline = Date.now() + 5_000
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`)
    await Bun.sleep(50)
  }
}

try {
  await waitForHealth()
  const suffix = Date.now()
  const alice = await signUp(`alice-${suffix}@example.com`)
  const bob = await signUp(`bob-${suffix}@example.com`)

  const signedOut = await fetch(`${base}/api/docs/doc-1/room`, {
    headers: { upgrade: 'websocket' },
  })
  if (signedOut.status !== 401)
    throw new Error(`signed-out upgrade answered ${signedOut.status}`)
  console.log('ok  signed-out upgrade is refused (401)')

  // DOC_ROOM_DOC pins the document, to check its stored data across restarts.
  const doc = process.env.DOC_ROOM_DOC ?? `doc-${suffix}`
  const a = await open(doc, alice)
  const b = await open(doc, bob)
  const other = await open(`other-${suffix}`, bob)
  a.socket.send('hello')
  await until('bob receives alice', () => b.messages.length === 1)
  const [received] = b.messages as { type: string; text: string }[]
  if (received?.type !== 'message' || received.text !== 'hello')
    throw new Error(`unexpected message ${JSON.stringify(received)}`)
  console.log('ok  a message reaches the other socket on the same document')

  a.socket.send('who')
  await until('room count', () => a.messages.length === 1)
  if ((a.messages[0] as { count: number }).count !== 2)
    throw new Error(`room holds ${JSON.stringify(a.messages[0])}`)
  await Bun.sleep(200)
  if (other.messages.length !== 0 || a.messages.length !== 1)
    throw new Error('a message crossed documents or echoed back')
  console.log('ok  one DocRoom per document, no echo, no cross-talk')
  console.log(`stored=${(a.messages[0] as { stored: number }).stored}`)

  for (const s of [a, b, other]) s.socket.close()
  console.log('doc-room: all checks passed')
} finally {
  dev?.kill('SIGINT')
  await dev?.exited
}
