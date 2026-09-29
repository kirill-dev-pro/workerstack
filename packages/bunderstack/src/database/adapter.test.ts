import { describe, expect, test } from 'bun:test'

import type { DatabaseAdapter } from './adapter'

describe('DatabaseAdapter', () => {
  test('is structural and carries an explicit driver', async () => {
    const adapter: DatabaseAdapter = {
      driver: 'libsql',
      connect: async () => ({ db: { isDb: true } }) as any,
      migrate: async () => {},
    }

    expect(adapter.driver).toBe('libsql')
    expect(await adapter.connect({}, { url: 'file:test.db' })).toEqual({
      db: { isDb: true },
    } as any)
  })
})
