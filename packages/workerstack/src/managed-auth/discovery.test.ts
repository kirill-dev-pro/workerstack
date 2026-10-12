import { expect, test } from 'bun:test'

import { getManagedProviders, readManagedAuth } from './index'
const config = {
  issuer: 'https://auth.example.com',
  clientId: 'client',
  clientSecret: 's'.repeat(40),
  revision: 1,
  version: 2 as const,
}
test('future protocol versions and invalid client config fail closed', () => {
  expect(() =>
    readManagedAuth({
      BUNDERHOST_AUTH_CONFIG: JSON.stringify({ ...config, version: 99 }),
    }),
  ).toThrow()
  expect(() =>
    readManagedAuth({
      BUNDERHOST_AUTH_CONFIG: JSON.stringify({ ...config, clientId: '' }),
    }),
  ).toThrow()
})
test('discovery includes only ready allowed providers and never exposes configuration secrets', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    Response.json({
      protocolVersion: 2,
      revision: 3,
      enabled: true,
      providers: [
        { id: 'google', label: 'Google', availability: 'ready' },
        { id: 'github', label: 'GitHub', availability: 'not_configured' },
      ],
    })) as unknown as typeof fetch
  try {
    const result = await getManagedProviders(config)
    expect(result.providers).toEqual([{ id: 'google', label: 'Google' }])
    expect(result.configRevision).toBe(3)
    expect(JSON.stringify(result)).not.toContain(config.clientSecret)
  } finally {
    globalThis.fetch = original
  }
})

test('discovery uses Workers-compatible manual redirects and rejects redirects', async () => {
  const original = globalThis.fetch
  let mode: RequestRedirect | undefined
  globalThis.fetch = (async (_input, options) => {
    mode = options?.redirect
    return new Response(null, {status: 302, headers: {location: 'https://untrusted.example'}})
  }) as typeof fetch
  try {
    const result = await getManagedProviders(config)
    expect(mode).toBe('manual')
    expect(result.state).toBe('unavailable')
    expect(result.providers).toEqual([])
  } finally { globalThis.fetch = original }
})
