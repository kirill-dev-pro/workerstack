import type { BetterAuthPlugin } from 'better-auth'

import {
  createAuthEndpoint,
  getOAuthState,
  signInSocial,
  APIError,
} from 'better-auth/api'
import * as v from 'valibot'

import { getManagedProviders, boundedJSON } from './discovery'
export { getManagedProviders } from './discovery'
export type { ManagedDiscovery, ManagedProvider } from './discovery'
import { genericOAuth } from 'better-auth/plugins'
import { createRemoteJWKSet, jwtVerify } from 'jose'
const digest = async (text: string) => {
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  )
  return btoa(String.fromCharCode(...hash))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}
export type ManagedAuthConfig = {
  version?: 1 | 2
  issuer: string
  clientId: string
  clientSecret: string
  revision: number
}
export function readManagedAuth(env: {
  BUNDERHOST_AUTH_CONFIG?: string
}): ManagedAuthConfig | null {
  if (!env.BUNDERHOST_AUTH_CONFIG) return null
  let input: unknown
  try {
    input = JSON.parse(env.BUNDERHOST_AUTH_CONFIG)
  } catch {
    throw new Error('Invalid managed authentication configuration')
  }
  const c = input as Partial<ManagedAuthConfig> | null
  if (
    !c ||
    typeof c.issuer !== 'string' ||
    typeof c.clientId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(c.clientId) ||
    (c.version !== undefined && c.version !== 1 && c.version !== 2) ||
    typeof c.clientSecret !== 'string' ||
    c.clientSecret.length < 32 ||
    !Number.isSafeInteger(c.revision) ||
    c.revision! < 1
  )
    throw new Error('Invalid managed authentication configuration')
  const url = new URL(c.issuer)
  if (url.protocol !== 'https:' || url.origin !== c.issuer)
    throw new Error('Managed authentication requires an HTTPS issuer origin')
  return c as ManagedAuthConfig
}
/** Add returned plugins to the application's Better Auth configuration.
 * Declare BUNDERHOST_AUTH_CONFIG as an optional sensitive server env key.
 * Existing account linking policy remains the application's responsibility. */
export function managedIdentityPlugins(env: {
  APP_URL?: string
  BUNDERHOST_AUTH_CONFIG?: string
}): BetterAuthPlugin[] {
  const config = readManagedAuth(env)
  const status = {
    id: 'bunderhost-managed-status',
    endpoints: {
      managedProviders: createAuthEndpoint(
        '/managed/providers',
        { method: 'GET' },
        async (ctx) => ctx.json(await getManagedProviders(config)),
      ),
      managedSignIn: createAuthEndpoint(
        '/managed/sign-in',
        {
          method: 'POST',
          body: v.object({
            provider: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
            callbackURL: v.optional(v.string()),
            errorCallbackURL: v.optional(v.string()),
          }),
        },
        async (ctx) => {
          if (!config)
            throw new APIError('BAD_REQUEST', {
              message: 'Managed sign-in is disabled',
            })
          const discovery = await getManagedProviders(config)
          if (!discovery.providers.some((p) => p.id === ctx.body.provider))
            throw new APIError('BAD_REQUEST', {
              message: 'Sign-in provider unavailable',
            })
          const origin = new URL(env.APP_URL!).origin
          for (const path of [ctx.body.callbackURL, ctx.body.errorCallbackURL])
            if (path && new URL(path, origin).origin !== origin)
              throw new APIError('BAD_REQUEST', {
                message: 'Invalid sign-in callback',
              })
          return signInSocial()({
            ...ctx,
            asResponse: true,
            body: {
              provider: 'bunderhost',
              callbackURL: ctx.body.callbackURL,
              errorCallbackURL: ctx.body.errorCallbackURL,
              additionalData: { managedProvider: ctx.body.provider },
            },
          })
        },
      ),
      managedAuthStatus: createAuthEndpoint(
        '/managed-auth/status',
        { method: 'GET' },
        async (ctx) =>
          ctx.json({
            adapterVersion: 2,
            protocolVersion: 2,
            enabled: Boolean(config),
            clientId: config?.clientId ?? null,
            revision: config?.revision ?? 0,
          }),
      ),
    },
  }
  if (!config) return [status]
  if (!env.APP_URL || new URL(env.APP_URL).protocol !== 'https:')
    throw new Error('Managed authentication requires the application HTTPS URL')
  const callback = `${new URL(env.APP_URL).origin}/api/auth/callback/bunderhost`
  const jwks = createRemoteJWKSet(
    new URL(`${config.issuer}/.well-known/jwks.json`),
  )
  const verify = async (token: string) =>
    (
      await jwtVerify(token, jwks, {
        issuer: config.issuer,
        audience: config.clientId,
        algorithms: ['RS256'],
      })
    ).payload
  const plugin = genericOAuth({
    config: [
      {
        providerId: 'bunderhost',
        redirectURI: callback,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        pkce: true,
        authorizationUrl: `${config.issuer}/api/auth/oauth2/authorize`,
        tokenUrl: `${config.issuer}/api/auth/oauth2/token`,
        userInfoUrl: `${config.issuer}/api/auth/oauth2/userinfo`,
        scopes: ['openid', 'profile', 'email'],
        getToken: async (data) => {
          if (!data.codeVerifier)
            throw new Error('Missing managed authentication PKCE verifier')
          const response = await fetch(
            `${config.issuer}/api/auth/oauth2/token`,
            {
              method: 'POST',
              redirect: 'manual',
              signal: AbortSignal.timeout(10000),
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: config.clientId,
                client_secret: config.clientSecret,
                code: data.code,
                code_verifier: data.codeVerifier,
                redirect_uri: data.redirectURI,
              }),
            },
          )
          if (!response.ok)
            throw new Error('Managed authentication token exchange failed')
          const tokens = (await boundedJSON(response)) as {
            access_token?: string
            id_token?: string
            expires_in?: number
          }
          if (!tokens.id_token || !tokens.access_token)
            throw new Error('Invalid managed authentication token response')
          const claims = await verify(tokens.id_token)
          if (claims.nonce !== (await digest(data.codeVerifier)))
            throw new Error('Invalid managed authentication nonce')
          const state = (await getOAuthState()) as {
            managedProvider?: string
          } | null
          if (
            state?.managedProvider &&
            claims.auth_provider !== state.managedProvider
          )
            throw new Error('Invalid managed authentication provider')
          return {
            accessToken: tokens.access_token,
            idToken: tokens.id_token,
            tokenType: 'Bearer',
            accessTokenExpiresAt: new Date(Date.now() + 300000),
            scopes: ['openid', 'profile', 'email'],
          }
        },
        getUserInfo: async (tokens) => {
          if (!tokens.idToken) return null
          const c = await verify(tokens.idToken)
          if (
            typeof c.sub !== 'string' ||
            typeof c.email !== 'string' ||
            c.email_verified !== true
          )
            return null
          return {
            id: c.sub,
            email: c.email,
            emailVerified: true,
            name: typeof c.name === 'string' ? c.name : c.email,
            image: typeof c.picture === 'string' ? c.picture : undefined,
          }
        },
      },
    ],
  })
  const originalInit = plugin.init
  const compatiblePlugin = {
    ...plugin,
    init: async (ctx: Parameters<typeof originalInit>[0]) => {
      if (ctx.socialProviders.some((p) => p.id === 'bunderhost'))
        throw new Error(
          'bunderhost provider is reserved for managed identity; remove the custom adapter or set auth.managedIdentity=false',
        )
      const result = await originalInit(ctx)
      for (const provider of result.context.socialProviders) {
        if (provider.id !== 'bunderhost') continue
        const originalURL = provider.createAuthorizationURL
        provider.createAuthorizationURL = async (data) => {
          if (!data.codeVerifier)
            throw new Error('Missing managed authentication PKCE verifier')
          const url = await originalURL(data)
          url.searchParams.set('nonce', await digest(data.codeVerifier))
          const state = (await getOAuthState()) as {
            managedProvider?: string
          } | null
          if (state?.managedProvider)
            url.searchParams.set('bunderhost_provider', state.managedProvider)
          return url
        }
      }
      return result
    },
  }
  return [status, compatiblePlugin]
}

/** Compatibility export: direct legacy Google signIn.social stays supported. */
export const managedGoogleAuth = managedIdentityPlugins
