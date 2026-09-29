import type { WorkerstackLogger, WorkerstackLogLevel } from '../logging'

export type TestLogMode = 'capture' | 'inherit' | 'silent'

export type TestLogEntry = {
  readonly level: WorkerstackLogLevel
  readonly message: string
  readonly args: readonly unknown[]
}

export type TestLogs = {
  readonly entries: readonly Readonly<TestLogEntry>[]
  readonly errors: readonly Readonly<TestLogEntry>[]
  readonly warnings: readonly Readonly<TestLogEntry>[]
  clear(): void
}

function render(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function createTestLogs(mode: TestLogMode = 'capture'): {
  logger: WorkerstackLogger
  logs: TestLogs
} {
  const entries: TestLogEntry[] = []
  const write = (level: WorkerstackLogLevel, args: unknown[]) => {
    if (mode !== 'silent') {
      entries.push(
        Object.freeze({
          level,
          message: args.map(render).join(' '),
          args: Object.freeze([...args]),
        }),
      )
    }
    if (mode === 'inherit') console[level](...args)
  }
  const snapshot = (level?: WorkerstackLogLevel) =>
    Object.freeze(
      entries.filter((entry) => !level || entry.level === level).slice(),
    )
  return {
    logger: {
      info: (...args) => write('info', args),
      warn: (...args) => write('warn', args),
      error: (...args) => write('error', args),
    },
    logs: {
      get entries() {
        return snapshot()
      },
      get errors() {
        return snapshot('error')
      },
      get warnings() {
        return snapshot('warn')
      },
      clear() {
        entries.length = 0
      },
    },
  }
}
