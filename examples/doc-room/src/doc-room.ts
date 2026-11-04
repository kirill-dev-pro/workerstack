// One DocRoom per document: everyone editing that document holds a WebSocket
// to the same instance, and a message from one reaches the others.
//
// It uses the hibernation API: `acceptWebSocket` hands the sockets to the
// runtime, which keeps them open while the object is evicted from memory and
// wakes it for `webSocketMessage`. Nothing per-connection may live only in
// fields; what a socket needs after a wake-up goes in its attachment.
//
// `DurableObject` comes from `workerstack/durable`: Cloudflare's own class in
// the Worker, a stand-in when `workerstack blueprint` loads this file in Bun.
// Keep Cloudflare-only code inside methods, not at the top of the module.
import { DurableObject, type HibernatableWebSocket } from 'workerstack/durable'

type Attachment = { userId: string }

export class DocRoom extends DurableObject {
  constructor(...args: ConstructorParameters<typeof DurableObject>) {
    super(...args)
    // The room's own SQLite: survives eviction, hibernation and redeploys.
    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, author TEXT NOT NULL, at INTEGER NOT NULL)',
    )
  }

  private stored(): number {
    const [row] = this.ctx.storage.sql
      .exec<{ total: number }>('SELECT count(*) AS total FROM messages')
      .toArray()
    return Number(row?.total ?? 0)
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
      return new Response('Expected a WebSocket', { status: 426 })
    // Set by src/server.ts after it checked the session; never by the client.
    const userId = request.headers.get('x-doc-user')
    if (!userId) return new Response('Unauthorized', { status: 401 })

    const [client, server] = Object.values(new WebSocketPair()) as [
      WebSocket,
      HibernatableWebSocket,
    ]
    this.ctx.acceptWebSocket(server, [userId])
    server.serializeAttachment({ userId } satisfies Attachment)
    return new Response(null, { status: 101, webSocket: client } as never)
  }

  async webSocketMessage(
    socket: HibernatableWebSocket,
    message: string | ArrayBuffer,
  ) {
    const from = (socket.deserializeAttachment() as Attachment | null)?.userId
    if (message === 'who') {
      socket.send(
        JSON.stringify({
          type: 'who',
          count: this.ctx.getWebSockets().length,
          stored: this.stored(),
        }),
      )
      return
    }
    // A real room batches its writes (see the recipe); one row per message
    // keeps the example small.
    this.ctx.storage.sql.exec(
      'INSERT INTO messages (author, at) VALUES (?, ?)',
      from ?? 'unknown',
      Date.now(),
    )
    for (const peer of this.ctx.getWebSockets())
      if (peer !== socket)
        peer.send(
          typeof message === 'string'
            ? JSON.stringify({ type: 'message', from, text: message })
            : message,
        )
  }

  async webSocketClose(
    socket: HibernatableWebSocket,
    code: number,
    reason: string,
  ) {
    socket.close(code, reason)
  }
}

declare const WebSocketPair: { new (): Record<0 | 1, WebSocket> }
