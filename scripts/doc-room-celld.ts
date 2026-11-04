#!/usr/bin/env bun
// Runs the built examples/doc-room artifact on celld (the VPS runtime) with
// the config workerstack renders for it (no `exports`, which celld refuses,
// and no `migrations`, which it ignores) and checks that the app's Durable
// Objects work and that a room's SQLite data survives a restart. Not part of
// `bun run test`.
//
//   CELLD_BIN=/path/to/celld bun scripts/doc-room-celld.ts
import type { Subprocess } from 'bun'

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const repo = join(import.meta.dir, '..')
const example = join(repo, 'examples/doc-room')
const celld = process.env.CELLD_BIN ?? 'celld'
const sqld =
  process.env.SQLD_BIN ??
  join(
    homedir(),
    '.cache/workerstack/sqld-v0.24.32-aarch64-apple-darwin/libsql-server-aarch64-apple-darwin/sqld',
  )
const AUTH_SECRET = 'doc-room-celld-secret-0123456789abcdef'
const processes: Subprocess[] = []
const cleanups: (() => Promise<unknown>)[] = []

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      )
    })
  })
}

async function waitFor(what: string, check: () => Promise<boolean>) {
  const deadline = Date.now() + 60_000
  while (!(await check().catch(() => false))) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await Bun.sleep(250)
  }
}

function spawn(cmd: string[], cwd = repo, env: Record<string, string> = {}) {
  const child = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  processes.push(child)
  const log: string[] = []
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream.pipeThrough(new TextDecoderStream()))
      log.push(chunk)
  }
  void pump(child.stdout)
  void pump(child.stderr)
  return { child, log }
}

async function stop(child: Subprocess) {
  child.kill('SIGINT')
  await child.exited
}

try {
  const dir = await mkdtemp(join(tmpdir(), 'doc-room-celld-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const dbPort = await freePort()
  const databaseUrl = `http://127.0.0.1:${dbPort}`
  spawn([
    sqld,
    '--http-listen-addr',
    `127.0.0.1:${dbPort}`,
    '-d',
    join(dir, 'db'),
  ])
  await waitFor('sqld', async () => (await fetch(`${databaseUrl}/health`)).ok)

  const { runBuild } = await import('../packages/workerstack/src/dev/index')
  if ((await runBuild({ directory: example })) !== 0)
    throw new Error('workerstack build failed')

  // Tables, as Bunderhost provisions them before a deploy.
  const { backend } = (await import(join(example, 'src/workerstack.ts'))) as {
    backend: { start(o: { env: Record<string, string> }): Promise<unknown> }
  }
  const { provision } = (await import(
    Bun.resolveSync('workerstack/provision-schema', example)
  )) as typeof import('../packages/workerstack/src/provision-schema')
  const app = await backend.start({
    env: { WORKERSTACK_DATABASE_URL: databaseUrl, AUTH_SECRET },
  })
  await provision(app as never, { force: true })
  await (app as { close(): Promise<void> }).close()

  const { parseWorkerBlueprintYaml, workerPlanFromBlueprint } =
    await import('../packages/workerstack/src/blueprint')
  const { toWranglerConfig } =
    await import('../packages/workerstack/src/workers/wrangler')
  const plan = workerPlanFromBlueprint(
    parseWorkerBlueprintYaml(
      await Bun.file(join(example, 'workerstack.blueprint.yaml')).text(),
    ),
  )
  const config = join(example, 'wrangler.celld.json')
  await writeFile(
    config,
    JSON.stringify(
      toWranglerConfig(
        plan,
        { name: 'doc-room', bucketName: (bucket) => `doc-room-${bucket}` },
        { artifact: true, runtime: 'celld' },
      ),
      null,
      2,
    ),
  )
  cleanups.push(() => rm(config, { force: true }))
  cleanups.push(() =>
    rm(join(example, '.celld'), { recursive: true, force: true }),
  )
  const rounds = ['first start', 'restart']

  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const devVars = join(example, '.dev.vars')
  await writeFile(
    devVars,
    [
      `WORKERSTACK_DATABASE_URL=${databaseUrl}`,
      `AUTH_SECRET=${AUTH_SECRET}`,
      `APP_URL=${base}`,
    ].join('\n'),
  )
  cleanups.push(() => rm(devVars, { force: true }))

  const stored: Record<string, number> = {}
  for (const [index, round] of rounds.entries()) {
    const server = spawn(
      [
        celld,
        'dev',
        config,
        '--port',
        String(port),
        '--no-watch',
        ...(index === 0 ? ['--clean'] : []),
      ],
      example,
      {
        CELLD_ESBUILD:
          process.env.CELLD_ESBUILD ?? join(repo, 'node_modules/.bin/esbuild'),
      },
    )
    try {
      await waitFor(
        `celld (${round})`,
        async () => (await fetch(`${base}/api/health`)).ok,
      )
      const checks = Bun.spawn(['bun', 'scripts/doc-room-dev.ts'], {
        cwd: repo,
        env: {
          ...process.env,
          DOC_ROOM_URL: base,
          DOC_ROOM_DOC: 'persistent-doc',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const out = await new Response(checks.stdout).text()
      const err = await new Response(checks.stderr).text()
      if ((await checks.exited) !== 0)
        throw new Error(`${round}: checks failed\n${out}\n${err}`)
      stored[round] = Number(/stored=(\d+)/.exec(out)?.[1])
      console.log(`[${round}] ${out.trim().replaceAll('\n', `\n[${round}] `)}`)
    } catch (error) {
      console.error(server.log.join('').slice(-4000))
      throw error
    } finally {
      await stop(server.child)
    }
  }
  const counts = rounds.map((round) => stored[round])
  if (counts.some((count, index) => count !== index + 1))
    throw new Error(
      `room data did not survive the config changes: ${JSON.stringify(stored)}`,
    )
  console.log('ok  the room kept its SQLite data across a celld restart')
  console.log('doc-room on celld: all checks passed')
} finally {
  for (const child of processes) child.kill('SIGINT')
  await Promise.all(processes.map((child) => child.exited))
  for (const cleanup of cleanups.reverse()) await cleanup()
}
