export type ManagedProvider = { id: string; label: string }
export type ManagedDiscovery = {
  protocolVersion: 2
  configRevision: number
  providers: ManagedProvider[]
  state: 'ready' | 'disabled' | 'unavailable'
  accountURL?: string
}
export type ManagedSignIn = {
  provider: string
  callbackURL?: string
  errorCallbackURL?: string
}
export function createManagedAuthClient(baseURL?: string) {
  const origin =
    baseURL ??
    (typeof window !== 'undefined' ? window.location.origin : undefined)
  const endpoint = (path: string) =>
    origin
      ? new URL(`/api/auth/managed/${path}`, origin).toString()
      : `/api/auth/managed/${path}`
  return {
    providers: async (): Promise<ManagedDiscovery> => {
      const r = await fetch(endpoint('providers'), { credentials: 'include' })
      if (!r.ok) throw new Error('Sign-in providers unavailable')
      return r.json()
    },
    signIn: async (input: ManagedSignIn) => {
      const r = await fetch(endpoint('sign-in'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!r.ok)
        return {
          error: { message: 'Sign-in provider unavailable' },
          data: null,
        }
      const data = (await r.json()) as { url?: string; redirect?: boolean }
      if (data.url && data.redirect && typeof window !== 'undefined')
        window.location.assign(data.url)
      return { data, error: null }
    },
  }
}
