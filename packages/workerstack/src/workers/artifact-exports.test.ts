import { expect, test } from 'bun:test'

import { exportedNames, missingDurableObjectExports } from './artifact-exports'

test('reads the export list a bundle ends with, aliases included', () => {
  const source = `var DocRoom = class {};
export { DocRoom, RateLimiter, x as RealtimeHub, Scheduler, worker_entry_default as default };`
  expect([...exportedNames(source)].sort()).toEqual([
    'DocRoom',
    'RateLimiter',
    'RealtimeHub',
    'Scheduler',
    'default',
  ])
  expect(exportedNames('export class Room {}\nexport const Other = 1')).toEqual(
    new Set(['Room', 'Other']),
  )
})

test('names the classes a bundle forgot to export', () => {
  expect(
    missingDurableObjectExports('export { Scheduler, default as default }', [
      'Scheduler',
      'DocRoom',
    ]),
  ).toEqual(['DocRoom'])
})
