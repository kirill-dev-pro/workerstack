import { registeredWorker } from '../workers/registry'

type IsolateContext = { request: () => Promise<Request> }

/** Longest a context-less in-isolate call waits for its background work. */
export const PENDING_WAIT_MS = 2_000

async function settleWithin(promises: Promise<unknown>[], ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.allSettled(promises),
    new Promise<void>((resolve) => (timer = setTimeout(resolve, ms))),
  ])
  clearTimeout(timer)
}

/**
 * SSR-aware fetch: the browser passes `/api/...` through as-is. On the server,
 * when this isolate runs the workerstack Worker (a package Worker entry
 * registered it), a relative URL goes to that Worker without a network hop and
 * carries the incoming request's cookie. Otherwise relative URLs are resolved against APP_URL when configured. This
 * keeps an internal HTTP reverse-proxy connection from triggering an HTTPS
 * redirect. Without APP_URL, use the incoming request's origin (via
 * @tanstack/react-start/server), then BETTER_AUTH_URL / localhost:3000.
 *
 * The server-only module uses a literal dynamic import so bundlers can analyze
 * the boundary statically; the `window` guard means it never runs in browsers.
 */
export function createIsomorphicFetch(
  options: {
    fetch?: typeof fetch
    /** Tests only: the incoming request for the in-isolate path. */
    isolate?: IsolateContext
  } = {},
) {
  const inner = options.fetch ?? fetch
  const isolate: IsolateContext = options.isolate ?? {
    request: async () =>
      (await import('@tanstack/react-start/server')).getRequest(),
  }
  return async function isomorphicFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (typeof window !== 'undefined') return inner(input, init)
    const registered = registeredWorker()
    if (registered && typeof input === 'string' && input.startsWith('/')) {
      const incoming = await isolate.request()
      const headers = new Headers(init?.headers)
      const cookie = incoming.headers.get('cookie')
      if (cookie && !headers.has('cookie')) headers.set('cookie', cookie)
      const url = new URL(input, new URL(incoming.url).origin)
      const request = new Request(url, { ...init, headers })
      // The API handler's background work (a Scheduler notify, a telemetry
      // flush) must outlive this call: hand it the page request's context.
      const ctx = registered.worker.context?.()
      if (ctx) return registered.worker.fetch(request, registered.env, ctx)
      // A custom entry that did not run the request through the Worker (or
      // `worker.withContext`): wait for that work rather than let the end of
      // the page response cancel it.
      const pending: Promise<unknown>[] = []
      const response = await registered.worker.fetch(request, registered.env, {
        waitUntil: (promise) => void pending.push(promise),
      })
      if (pending.length) await settleWithin(pending, PENDING_WAIT_MS)
      return response
    }
    if (typeof input === 'string' && input.startsWith('/')) {
      let origin = process.env.APP_URL
      if (origin === undefined) {
        try {
          const mod = await import('@tanstack/react-start/server')
          origin = new URL(mod.getRequest().url).origin
        } catch {
          // No request context (background job, test) — fall through to env.
        }
      }
      origin ??= process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
      return inner(new URL(input, origin), init)
    }
    return inner(input, init)
  }
}
