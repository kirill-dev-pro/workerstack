import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { blueprintFromManifest, serializeBlueprint } from './blueprint'
import { workerstack } from './vite'

async function app(render: 'ssr' | 'spa') {
  const root = await mkdtemp(join(tmpdir(), 'workerstack-vite-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'app' }))
  const blueprint = blueprintFromManifest({
    manifest: {
      version: 4,
      database: {
        dialect: 'sqlite',
        migrationsDirectory: './migrations',
        tables: [],
      },
      storage: {
        defaultBucket: 'media',
        buckets: [{ name: 'media', visibility: 'private' }],
      },
      realtime: { required: false },
      messaging: { channels: [] },
      environment: [],
      api: { operations: [] },
      background: { jobs: [], cron: [], maintenance: [] },
    },
    generatorVersion: '1.0.0-beta.4',
    entry: 'src/workerstack.ts',
    migrationMode: 'push',
    worker: {
      render,
      main:
        render === 'ssr'
          ? 'workerstack/start/server-entry'
          : 'workerstack/workers/entry',
      compatibilityDate: '2026-09-28',
      assets: 'dist/client',
    },
  })
  await writeFile(
    join(root, 'workerstack.blueprint.yaml'),
    serializeBlueprint(blueprint),
  )
  return root
}

const factories = {
  cloudflare: (options: unknown) => ({ name: 'cloudflare', options }),
  tanstackStart: (options: unknown) => ({ name: 'tanstack-start', options }),
}

test('ssr: backend resolver, Cloudflare on the ssr environment, then Start', async () => {
  const root = await app('ssr')
  try {
    const plugins = (await workerstack({ root, factories })) as {
      name: string
      options?: unknown
      resolveId?: (id: string) => unknown
    }[]
    expect(plugins.map((p) => p.name)).toEqual([
      'workerstack:backend',
      'cloudflare',
      'tanstack-start',
    ])
    expect(plugins[1]!.options).toEqual({ viteEnvironment: { name: 'ssr' } })
    expect(plugins[0]!.resolveId!('virtual:workerstack/backend')).toBe(
      join(root, 'src/workerstack.ts'),
    )
    expect(plugins[0]!.resolveId!('other')).toBeUndefined()
    // SSR pages import from all of src: scan it so no dependency is found
    // late, which re-optimizes mid-start.
    const config = (plugins[0] as unknown as { config(): any }).config()
    expect(config.environments.ssr.optimizeDeps).toEqual({
      include: ['workerstack/start/server-entry'],
      entries: [
        'src/**/*.{ts,tsx,js,jsx}',
        '!src/**/*.{test,spec}.{ts,tsx,js,jsx}',
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('spa: no Start plugin; outDirs match the artifact', async () => {
  const root = await app('spa')
  try {
    const plugins = (await workerstack({ root, factories })) as {
      name: string
      config?: () => unknown
    }[]
    expect(plugins.map((p) => p.name)).toEqual([
      'workerstack:backend',
      'cloudflare',
    ])
    expect(plugins[0]!.config!()).toEqual({
      environments: {
        client: { build: { outDir: 'dist/client' } },
        ssr: {
          build: { outDir: 'dist/server' },
          // An SPA's Worker runs only the backend: scan from its entry.
          optimizeDeps: {
            include: ['workerstack/workers/entry'],
            entries: [join(root, 'src/workerstack.ts')],
          },
        },
      },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a missing blueprint asks to generate it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workerstack-vite-'))
  try {
    await writeFile(join(root, 'package.json'), '{}')
    await expect(workerstack({ root, factories })).rejects.toThrow(
      /workerstack blueprint/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
