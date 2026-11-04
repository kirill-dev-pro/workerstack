import { expect, test } from 'bun:test'

import type { WorkerPlan } from '../worker-plan'

import { toWranglerConfig } from './wrangler'

const plan: WorkerPlan = {
  render: 'spa',
  main: 'src/worker.ts',
  compatibilityDate: '2026-09-28',
  compatibilityFlags: ['nodejs_compat'],
  durableObjects: {
    bindings: [
      { name: 'SCHEDULER', className: 'Scheduler' },
      { name: 'REALTIME', className: 'RealtimeHub' },
      { name: 'RATE_LIMITER', className: 'RateLimiter' },
    ],
    classes: [
      { className: 'Scheduler' },
      { className: 'RealtimeHub' },
      { className: 'RateLimiter' },
    ],
  },
  buckets: [{ name: 'media', binding: 'BUCKET_MEDIA' }],
  crons: ['0 4 * * *', '0 8 * * *'],
  assets: {
    directory: 'dist/client',
    notFoundHandling: 'single-page-application',
    runWorkerFirst: ['/api/*', '/webhooks/*'],
  },
  artifact: {
    main: 'dist/server/index.js',
    assets: 'dist/client',
    modules: true,
  },
}

test('wrangler.json is the plan with local physical names', () => {
  expect(
    toWranglerConfig(plan, {
      name: 'fikflix',
      bucketName: (bucket) => `fikflix-${bucket}`,
    }),
  ).toEqual({
    name: 'fikflix',
    main: 'src/worker.ts',
    compatibility_date: '2026-09-28',
    compatibility_flags: ['nodejs_compat'],
    durable_objects: {
      bindings: [
        { name: 'SCHEDULER', class_name: 'Scheduler' },
        { name: 'REALTIME', class_name: 'RealtimeHub' },
        { name: 'RATE_LIMITER', class_name: 'RateLimiter' },
      ],
    },
    exports: {
      Scheduler: { type: 'durable-object', storage: 'sqlite' },
      RealtimeHub: { type: 'durable-object', storage: 'sqlite' },
      RateLimiter: { type: 'durable-object', storage: 'sqlite' },
    },
    r2_buckets: [{ binding: 'BUCKET_MEDIA', bucket_name: 'fikflix-media' }],
    assets: {
      directory: 'dist/client',
      binding: 'ASSETS',
      not_found_handling: 'single-page-application',
      run_worker_first: ['/api/*', '/webhooks/*'],
    },
    triggers: { crons: ['0 4 * * *', '0 8 * * *'] },
  })
})

test('app classes bind live, a deleted one stays as a tombstone, celld gets no exports', () => {
  const withApp = {
    ...plan,
    durableObjects: {
      bindings: [
        ...plan.durableObjects.bindings,
        { name: 'DOC_ROOM', className: 'DocRoom' },
      ],
      classes: [
        ...plan.durableObjects.classes,
        { className: 'DocRoom' },
        { className: 'OldRoom', deleted: true as const },
      ],
    },
  }
  const names = { name: 'app', bucketName: (bucket: string) => bucket }
  const config = toWranglerConfig(withApp, names)
  expect(config.durable_objects.bindings.at(-1)).toEqual({
    name: 'DOC_ROOM',
    class_name: 'DocRoom',
  })
  expect(config.exports).toMatchObject({
    DocRoom: { type: 'durable-object', storage: 'sqlite' },
    OldRoom: { type: 'durable-object', state: 'deleted' },
  })
  expect('migrations' in config).toBe(false)
  const celld = toWranglerConfig(withApp, names, { runtime: 'celld' })
  expect('exports' in celld).toBe(false)
  expect('migrations' in celld).toBe(false)
  expect(celld.durable_objects.bindings).toHaveLength(4)
})

test('no crons means no triggers key', () => {
  const config = toWranglerConfig(
    { ...plan, crons: [] },
    { name: 'app', bucketName: (bucket) => bucket },
  )
  expect('triggers' in config).toBe(false)
})

test('the artifact form points at the built Worker and asset directory', () => {
  const config = toWranglerConfig(
    {
      ...plan,
      render: 'ssr',
      main: 'workerstack/start/server-entry',
      assets: {
        directory: 'dist/client',
        notFoundHandling: 'none',
        runWorkerFirst: [],
      },
    },
    { name: 'app', bucketName: (bucket) => `app-${bucket}` },
    { artifact: true },
  )
  expect(config.main).toBe('dist/server/index.js')
  expect(config.assets).toEqual({
    directory: 'dist/client',
    binding: 'ASSETS',
    not_found_handling: 'none',
  })
})

test('the source form keeps the package entry as main', () => {
  const config = toWranglerConfig(
    { ...plan, main: 'workerstack/workers/entry' },
    { name: 'app', bucketName: (bucket) => bucket },
  )
  expect(config.main).toBe('workerstack/workers/entry')
  expect(config.assets.run_worker_first).toEqual(['/api/*', '/webhooks/*'])
})
