export type WorkerstackLogLevel = 'info' | 'warn' | 'error'

export type WorkerstackLogger = {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export const consoleLogger: WorkerstackLogger = {
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
}
