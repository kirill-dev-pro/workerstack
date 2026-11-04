# Recipe: your own Durable Objects (a room per document)

A workerstack app can declare its own Durable Object classes next to the three
workerstack binds itself (`Scheduler`, `RealtimeHub`, `RateLimiter`). The
example in [`examples/doc-room`](../../examples/doc-room) is a collaborative
document room: one object per document, WebSockets with hibernation, and the
room's own SQLite.

Run it: `bun scripts/doc-room-dev.ts` (in `workerstack dev`) and
`CELLD_BIN=… bun scripts/doc-room-celld.ts` (on celld).

## 1. Write the class

```ts
// src/doc-room.ts
import { DurableObject, type HibernatableWebSocket } from 'workerstack/durable'

export class DocRoom extends DurableObject {
  async fetch(request: Request) {
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server) // hibernation: the object may sleep
    return new Response(null, { status: 101, webSocket: client })
  }
  async webSocketMessage(socket: HibernatableWebSocket, message: string) {
    for (const peer of this.ctx.getWebSockets())
      if (peer !== socket) peer.send(message)
  }
}
```

`workerstack/durable` is Cloudflare's `DurableObject` in the Worker and a
stand-in of the same shape in Bun, where `workerstack blueprint` loads your
declaration. So keep Cloudflare-only code (`WebSocketPair`, libraries that
touch the runtime when imported) inside methods, not at the top of the module.

## 2. Declare it

```ts
// src/workerstack.ts
import { DocRoom } from './doc-room'

export const backend = workerstack({
  // …
  durableObjects: { DOC_ROOM: DocRoom }, // env.DOC_ROOM
})
```

The key is the env binding; the class name comes from the class. Both reach
the blueprint (`application.worker.durableObjects`) and from there
`wrangler.json`, `workerstack dev` and the host.

## 3. Export it from the Worker

- With the package entry (`workerstack/workers/entry`,
  `workerstack/start/server-entry`) there is nothing to do: it exports every
  declared class.
- With your own entry (`src/server.ts`), re-export the class from its module,
  under the name it is declared with:

  ```ts
  const worker = createWorker(backend)
  export const { Scheduler, RealtimeHub, RateLimiter } = worker.durableObjects
  export { DocRoom } from './doc-room'
  ```

`workerstack build` fails when a bound class is not exported, before
Cloudflare would refuse the deploy.

## 4. Route to it

Check the session and the document's permissions in the Worker, then hand the
request to the document's object. Pass the user id in a header you set; never
trust one the client sent.

```ts
const room = /^\/api\/docs\/([^/]+)\/room$/.exec(new URL(request.url).pathname)
if (room) {
  const app = await worker.app(env)
  const session = await app.auth.api.getSession({ headers: request.headers })
  if (!session) return new Response('Unauthorized', { status: 401 })
  const headers = new Headers(request.headers)
  headers.set('x-doc-user', session.user.id)
  const id = env.DOC_ROOM.idFromName(room[1])
  return env.DOC_ROOM.get(id).fetch(new Request(request, { headers }))
}
```

`/api/*` already reaches the Worker before static assets.

## Data: the room and the app database

Give each kind of data one owner:

| Data | Owner |
|---|---|
| The document body, its edit log, comments and cursors inside it | the room's SQLite (`this.ctx.storage.sql`) |
| Users, workspaces, permissions, sharing | the app database (Turso) |
| The document catalog: id, title, owner, size, `updatedAt`, `rev`, `deletedAt` | the app database; the room writes its row |

- The room keeps a monotonic `rev` and writes its catalog row after a delay
  (an alarm every 30–60 s, and when the last participant leaves) with
  `INSERT … ON CONFLICT DO UPDATE … WHERE rev < excluded.rev`. A retry or an
  out-of-order write is harmless; if the database is down, the alarm retries.
- Batch writes to the room's SQLite (a snapshot or compacted updates every few
  seconds). One row per keystroke costs about 60× more.
- Schema changes inside the room: `drizzle-orm/durable-sqlite` with its own
  migrations folder, applied in the constructor under
  `ctx.blockConcurrencyWhile`. Additive changes only. The host does not see
  these migrations.
- Delete a document softly: set `deletedAt` in the catalog and destroy the
  room (`ctx.storage.deleteAll()`) from a job 30 days later. Cloudflare keeps
  30 days of point-in-time recovery per object, but `deleteAll()` is final.

## Removing or renaming a class

Cloudflare provisions the classes from an `exports` map; removing a line from
the declaration is not a deletion, it is an error (the objects and their data
still exist). To delete a class and all its data:

1. remove the class from the Worker's exports;
2. keep it declared as `{ class: DocRoom, deleted: true }`;
3. deploy. On Cloudflare the namespace and its data are destroyed; on celld
   the data stays in the environment's bucket.

## Runtimes

- **Cloudflare**: `wrangler.json` carries an `exports` map (no migration
  tags). The first deploy with it moves an existing Worker off `migrations`
  for good; data is kept.
- **celld**: refuses `exports` and ignores `migrations`; write its config with
  `workerstack wrangler --celld`. App Durable Objects, WebSockets and their
  SQLite work there.
- **`workerstack dev`**: runs the classes in workerd with hibernation.

## Cost (Cloudflare, Workers Paid)

Requests $0.15 per million (20 WebSocket messages count as one request),
duration $12.50 per million GB-s while an object is awake, SQLite writes $1
per million rows. A room that keeps sockets without hibernation is billed for
every second they are open; with `acceptWebSocket` it is billed only while it
handles a message.
