import { betterAuth } from 'better-auth'
import { expect, test } from 'bun:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

import { managedIdentityPlugins } from './index'

const issuer = 'https://identity.example.com'
const appURL = 'https://app.example.com'
const cookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')

for (const scenario of [
  'valid',
  'wrong-provider',
  'wrong-nonce',
  'unverified-email',
] as const) {
  test(`managed callback ${scenario} validates signed identity before creating a session`, async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const jwk = {
      ...(await exportJWK(publicKey)),
      kid: 'test',
      alg: 'RS256',
      use: 'sig',
    }
    let nonce = ''
    const original = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/.well-known/jwks.json'))
        return Response.json({ keys: [jwk] })
      if (url.endsWith('/api/auth/oauth2/token')) {
        const idToken = await new SignJWT({
          nonce: scenario === 'wrong-nonce' ? 'wrong' : nonce,
          auth_provider: scenario === 'wrong-provider' ? 'google' : 'github',
          email: 'person@example.com',
          email_verified: scenario !== 'unverified-email',
          name: 'Person',
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'test' })
          .setIssuer(issuer)
          .setAudience('client')
          .setSubject('pairwise-user')
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey)
        return Response.json({
          access_token: 'access',
          id_token: idToken,
          expires_in: 300,
        })
      }
      return Response.json({
        protocolVersion: 2,
        revision: 1,
        enabled: true,
        providers: [{ id: 'github', label: 'GitHub', availability: 'ready' }],
      })
    }) as unknown as typeof fetch
    try {
      const auth = betterAuth({
        baseURL: appURL,
        secret: 's'.repeat(40),
        logger: { disabled: true },
        plugins: managedIdentityPlugins({
          APP_URL: appURL,
          BUNDERHOST_AUTH_CONFIG: JSON.stringify({
            version: 2,
            issuer,
            clientId: 'client',
            clientSecret: 's'.repeat(40),
            revision: 1,
          }),
        }),
      })
      const start = await auth.handler(
        new Request(appURL + '/api/auth/managed/sign-in', {
          method: 'POST',
          headers: { origin: appURL, 'content-type': 'application/json' },
          body: JSON.stringify({
            provider: 'github',
            callbackURL: '/profile',
            errorCallbackURL: '/error',
          }),
        }),
      )
      expect(start.status).toBe(200)
      const authorization = new URL((await start.json()).url)
      nonce = authorization.searchParams.get('nonce')!
      const callback = await auth.handler(
        new Request(
          appURL +
            '/api/auth/callback/bunderhost?code=code&state=' +
            encodeURIComponent(authorization.searchParams.get('state')!),
          { headers: { cookie: cookieHeader(start) } },
        ),
      )
      expect(callback.status).toBe(302)
      if (scenario === 'valid') {
        expect(new URL(callback.headers.get('location')!,appURL).href).toBe(appURL + '/profile')
        const session = await auth.api.getSession({
          headers: new Headers({ cookie: cookieHeader(callback) }),
        })
        expect(session?.user.email).toBe('person@example.com')
      } else {
        expect(callback.headers.get('location')).toContain('/error?error=')
        expect(
          await auth.api.getSession({
            headers: new Headers({ cookie: cookieHeader(callback) }),
          }),
        ).toBeNull()
      }
    } finally {
      globalThis.fetch = original
    }
  })
}
