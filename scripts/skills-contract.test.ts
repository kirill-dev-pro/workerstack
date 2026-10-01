import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const skill = resolve(root, '.agents/skills/creating-workerstack-apps')

function read(...parts: string[]) {
  return readFileSync(resolve(root, ...parts), 'utf8')
}

describe('creating-workerstack-apps skill', () => {
  test('declares a discoverable repository skill', () => {
    const markdown = readFileSync(resolve(skill, 'SKILL.md'), 'utf8')
    expect(markdown).toContain('name: creating-workerstack-apps')
    expect(markdown).toContain('description: Use when')
    expect(existsSync(resolve(skill, 'agents/openai.yaml'))).toBe(true)
  })

  test('points new apps to the reference example without embedding it', () => {
    const markdown = readFileSync(resolve(skill, 'SKILL.md'), 'utf8')
    expect(markdown).toContain('examples/todo-solid-native')
    expect(existsSync(resolve(skill, 'assets'))).toBe(false)
  })

  test('documents the unified oRPC and realtime contracts', () => {
    const markdown = [
      read('.agents/skills/creating-workerstack-apps/SKILL.md'),
      read(
        '.agents/skills/creating-workerstack-apps/references/application-structure.md',
      ),
      read(
        '.agents/skills/creating-workerstack-apps/references/runtime-integrations.md',
      ),
    ].join('\n')

    expect(markdown).toContain('oRPC')
    expect(markdown).toContain('realtime.changes')
    expect(markdown).toContain('heartbeat')
    expect(markdown).not.toContain('protected tRPC')
    expect(markdown).not.toContain('trpc/')
  })
})

describe('migrating-to-workerstack skill', () => {
  const dir = '.agents/skills/migrating-to-workerstack'

  test('declares a discoverable repository skill', () => {
    const markdown = read(dir, 'SKILL.md')
    expect(markdown).toContain('name: migrating-to-workerstack')
    expect(markdown).toContain('description: Use when')
    expect(existsSync(resolve(root, dir, 'agents/openai.yaml'))).toBe(true)
  })

  test('stops on blockers before any code moves', () => {
    const skill = read(dir, 'SKILL.md')
    const audit = read(dir, 'references/compatibility-audit.md')
    expect(skill).toContain('Do not start a\n     partial migration')
    expect(audit).toContain('Blocked')
    expect(audit).toContain('copies the Tigris bucket into R2')
    expect(audit).toContain('Worker apps do not run on managed Fly')
  })

  test('moves the files to the celld layout on a server', () => {
    const cutover = read(dir, 'references/hosting-cutover.md')
    expect(cutover).toContain('celld/r2/<appName>-<bucket>/<bucket>/<name>')
  })
})

describe('skills teach the current API declaration', () => {
  test('creating skill declares bases at module scope', () => {
    const markdown = read(
      '.agents/skills/creating-workerstack-apps/references/application-structure.md',
    )

    expect(markdown).toContain('defineApi({ schema, env: envSchema })')
    expect(markdown).toContain('Do not write a router factory')
    expect(markdown).toContain('o.protected.use(')
    expect(markdown).toContain('errors.FORBIDDEN(')
    expect(markdown).toContain('listSpec(appLogs')
    expect(markdown).toContain('WorkerstackDb<typeof schema>')
  })

  test('creating skill states the middleware coverage gap', () => {
    const markdown = read(
      '.agents/skills/creating-workerstack-apps/references/application-structure.md',
    )

    expect(markdown).toContain('never pass through a base the application')
    expect(markdown).toContain('middleware: [instrumentation]')
    expect(markdown).toContain('context.peekSession()')
    expect(markdown).toContain('never for\nauthorization')
    expect(markdown).toContain('when the stream closes')
  })
})

describe('skills delivery', () => {
  test('the package ships the skills it installs', () => {
    const pkg = JSON.parse(read('packages/workerstack/package.json')) as {
      files: string[]
    }
    expect(pkg.files).toContain('skills')

    // The canonical copy stays in .agents/skills; the build copies it.
    const build = read('scripts/build-package.ts')
    expect(build).toContain("'creating-workerstack-apps'")
    expect(build).toContain("'migrating-to-workerstack'")
    expect(build).toContain('.agents/skills')
  })

  test('the CLI documents and implements the install command', () => {
    const cli = read('packages/workerstack/src/cli.ts')
    expect(cli).toContain("args[0] === 'skills'")
    expect(cli).toContain('workerstack skills [--dir <path>] [--check]')
  })
})
