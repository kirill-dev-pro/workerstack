// The Worker of the DocRoom recipe. The blueprint names this file as `main`
// (workerstack picks src/server.ts when it exists), so it exports every
// Durable Object class the Worker binds: workerstack's three and DocRoom,
// declared in src/workerstack.ts. Re-export an app class from its own module
// under the name it is declared with; `workerstack build` checks it.
//
// /api/docs/<id>/room upgrades to a WebSocket on that document's DocRoom,
// after the session is checked here; everything else is the backend.
import { createWorker, type ExecutionContextLike } from 'workerstack/workers'

import { backend } from './workerstack'

type DurableObjectNamespace = {
  idFromName(name: string): unknown
  get(id: unknown): { fetch(request: Request): Promise<Response> }
}
type Env = { DOC_ROOM: DurableObjectNamespace }
type App = {
  auth: {
    api: {
      getSession(input: {
        headers: Headers
      }): Promise<{ user: { id: string } } | null>
    }
  }
}

const worker = createWorker(backend)
export const { Scheduler, RealtimeHub, RateLimiter } = worker.durableObjects
export { DocRoom } from './doc-room'

const ROOM = /^\/api\/docs\/([^/]+)\/room$/

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContextLike,
  ): Promise<Response> {
    const room = ROOM.exec(new URL(request.url).pathname)
    if (!room) return worker.handler.fetch(request, env as never, ctx)
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
      return new Response('Expected a WebSocket', { status: 426 })
    return worker.withContext(ctx, async () => {
      const app = (await worker.app(env as never)) as unknown as App
      const session = await app.auth.api.getSession({
        headers: request.headers,
      })
      if (!session) return new Response('Unauthorized', { status: 401 })
      // Check here that this user may open this document.
      const headers = new Headers(request.headers)
      headers.set('x-doc-user', session.user.id)
      const id = env.DOC_ROOM.idFromName(decodeURIComponent(room[1]!))
      return env.DOC_ROOM.get(id).fetch(new Request(request, { headers }))
    })
  },
  scheduled: worker.handler.scheduled,
}
