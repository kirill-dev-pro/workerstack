import { expect, test } from 'bun:test'

import { WORKERSTACK_VERSION } from './version'

test('the version constant matches package.json', async () => {
  const pkg = (await Bun.file(
    new URL('../package.json', import.meta.url),
  ).json()) as {
    version: string
  }
  expect(WORKERSTACK_VERSION).toBe(pkg.version)
})
