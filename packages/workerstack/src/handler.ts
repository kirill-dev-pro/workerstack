// src/handler.ts
import type { RateLimitStore } from './platform'

import { INBOUND_PATH } from './messaging/inbound'
import { createRateLimiter, type RateLimitConfig } from './rate-limit'

interface HandlerParts {
  /** Answers `/api/auth/*`; null hands the request to the API routes. */
  authHandler?: (req: Request) => Promise<Response | null>
  apiHandler?: (req: Request) => Promise<Response | null>
  /** Mail the host delivers; signed, so it bypasses the per-IP rate limit. */
  inboundHandler?: (req: Request) => Promise<Response>
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
    const pathname = new URL(req.url).pathname
    // The host retries a delivery from one address; a rate limit would turn
    // a burst of mail into rejected deliveries. The signature is the gate.
    if (parts.inboundHandler && pathname === INBOUND_PATH) {
      return parts.inboundHandler(req)
    }

    const limited = await checkRateLimit(req)
    if (limited) return limited

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
