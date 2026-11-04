import { expect, test } from 'bun:test'

import {
  assertNoDroppedDurableObjects,
  describeDurableObjects,
  liveDurableObjectClasses,
} from './durable-objects'

class DocRoom {}
class OldRoom {}

test('the declaration names each class by the class itself, sorted by binding', () => {
  expect(
    describeDurableObjects({
      OLD_ROOM: { class: OldRoom, deleted: true },
      DOC_ROOM: DocRoom,
    }),
  ).toEqual([
    { binding: 'DOC_ROOM', className: 'DocRoom' },
    { binding: 'OLD_ROOM', className: 'OldRoom', deleted: true },
  ])
  expect(describeDurableObjects(undefined)).toEqual([])
})

test('anonymous classes and malformed entries are refused', () => {
  const anonymous = (() => class {})()
  expect(() => describeDurableObjects({ ROOM: anonymous })).toThrow(
    /named class/,
  )
  expect(() =>
    describeDurableObjects({ ROOM: { deleted: true } as never }),
  ).toThrow(/is a class/)
})

test('the Worker gets only live classes, keyed by binding', () => {
  expect(
    liveDurableObjectClasses({
      DOC_ROOM: DocRoom,
      OLD_ROOM: { class: OldRoom, deleted: true },
    }),
  ).toEqual({ DOC_ROOM: DocRoom })
})

test('a declared class may not vanish; a deleted one may stay or go', () => {
  const room = { binding: 'DOC_ROOM', className: 'DocRoom' }
  expect(() => assertNoDroppedDurableObjects([room], [room])).not.toThrow()
  expect(() =>
    assertNoDroppedDurableObjects([room], [{ ...room, deleted: true }]),
  ).not.toThrow()
  expect(() => assertNoDroppedDurableObjects([room], [])).toThrow(
    /deleted: true/,
  )
  expect(() =>
    assertNoDroppedDurableObjects(
      [room],
      [{ binding: 'DOC_ROOM', className: 'DocumentRoom' }],
    ),
  ).toThrow(/DocRoom/)
  expect(() =>
    assertNoDroppedDurableObjects([{ ...room, deleted: true }], []),
  ).not.toThrow()
})
