import type { ManagedAuthConfig } from './index'
export type ManagedProvider = { id: string; label: string }
export type ManagedDiscovery = {
  protocolVersion: 2
  configRevision: number
  providers: ManagedProvider[]
  state: 'ready' | 'disabled' | 'unavailable'
  accountURL?: string
}
export async function boundedJSON(
  response: Response,
  max = 16384,
): Promise<unknown> {
  if (!response.body) throw new Error('Identity response unavailable')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const r = await reader.read()
      if (r.done) break
      size += r.value.length
      if (size > max) throw new Error('Identity response too large')
      chunks.push(r.value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.length
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}
export async function getManagedProviders(
  config: ManagedAuthConfig | null,
): Promise<ManagedDiscovery> {
  if (!config)
    return {
      protocolVersion: 2,
      configRevision: 0,
      providers: [],
      state: 'disabled',
    }
  try {
    const response = await fetch(
      `${config.issuer}/internal/public/clients/${encodeURIComponent(config.clientId)}/providers`,
      { redirect: 'error', signal: AbortSignal.timeout(5000) },
    )
    if (!response.ok) throw new Error('Identity discovery unavailable')
    const value = (await boundedJSON(response)) as {
      protocolVersion?: number
      revision?: number
      enabled?: boolean
      providers?: unknown
    }
    if (
      value.protocolVersion !== 2 ||
      !Number.isSafeInteger(value.revision) ||
      typeof value.enabled !== 'boolean' ||
      !Array.isArray(value.providers) ||
      value.providers.length > 20
    )
      throw new Error('Invalid identity discovery')
    const providers = value.providers
      .map((p) => {
        if (
          !p ||
          typeof p.id !== 'string' ||
          !/^[a-z][a-z0-9_-]{0,63}$/.test(p.id) ||
          typeof p.label !== 'string' ||
          p.label.length > 100 ||
          !['ready', 'not_configured', 'unavailable'].includes(p.availability)
        )
          throw new Error('Invalid identity provider')
        return p
      })
      .filter((p) => p.availability === 'ready')
      .map((p) => ({ id: p.id, label: p.label }))
    return {
      protocolVersion: 2,
      configRevision: value.revision!,
      providers: value.enabled ? providers : [],
      state: value.enabled ? 'ready' : 'disabled',
      accountURL: `${config.issuer}/account?client_id=${encodeURIComponent(config.clientId)}`,
    }
  } catch {
    return {
      protocolVersion: 2,
      configRevision: config.revision,
      providers: [],
      state: 'unavailable',
    }
  }
}
