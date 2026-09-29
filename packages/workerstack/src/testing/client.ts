import type { AnyWorkerstackApp, WorkerstackClient } from '../client/rpc-client'
import type { TestIdentity } from './auth'

import { createClient } from '../client/rpc-client'

export function testClient<TApp extends AnyWorkerstackApp>(
  app: TApp & { handler(request: Request): Promise<Response> },
  identity?: TestIdentity,
): WorkerstackClient<TApp> {
  return createClient<TApp>({
    baseUrl: 'http://workerstack.test/api',
    fetch: (input, init) => app.handler(new Request(input, init)),
    headers: identity?.headers,
  })
}
