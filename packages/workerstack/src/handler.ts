// src/handler.ts
import type { RateLimitStore } from './platform'

import { createRateLimiter, type RateLimitConfig } from './rate-limit'

interface HandlerParts {
  /** Answers `/api/auth/*`; null hands the request to the API routes. */
  authHandler?: (req: Request) => Promise<Response | null>
  apiHandler?: (req: Request) => Promise<Response | null>
  rateLimit?: boolean | RateLimitConfig
  rateLimitStore?: RateLimitStore
}

export function buildHandler(
  parts: HandlerParts,
): (req: Request) => Promise<Response> {
  const checkRateLimit = createRateLimiter(
    parts.rateLimit,
    parts.rateLimitStore,
  )

  return async (req: Request): Promise<Response> => {
    const limited = await checkRateLimit(req)
    if (limited) return limited

    const pathname = new URL(req.url).pathname
    if (
      parts.authHandler &&
      (pathname === '/api/auth' || pathname.startsWith('/api/auth/'))
    ) {
      const authRes = await parts.authHandler(req)
      if (authRes) return authRes
    }
    if (parts.apiHandler) {
      const apiRes = await parts.apiHandler(req)
      if (apiRes) return apiRes
    }
    return new Response('Not Found', { status: 404 })
  }
}
