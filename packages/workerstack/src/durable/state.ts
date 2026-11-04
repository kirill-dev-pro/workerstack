// The parts of Cloudflare's DurableObjectState a workerstack app uses most,
// typed locally so `workerstack/durable` needs no Cloudflare type package.
// Apps that want the complete types cast `this.ctx` to their own.

export interface DurableObjectSqlCursor<T = Record<string, unknown>> {
  toArray(): T[]
  one(): T
  [Symbol.iterator](): Iterator<T>
}

export interface DurableObjectSql {
  exec<T = Record<string, unknown>>(
    query: string,
    ...bindings: unknown[]
  ): DurableObjectSqlCursor<T>
  readonly databaseSize: number
}

export interface DurableObjectStorage {
  readonly sql: DurableObjectSql
  getAlarm(): Promise<number | null>
  setAlarm(scheduledTime: number | Date): Promise<void>
  deleteAlarm(): Promise<void>
  /** Removes every row and the object itself once it shuts down. */
  deleteAll(): Promise<void>
  getBookmarkForTime(timestamp: number | Date): Promise<string>
  onNextSessionRestoreBookmark(bookmark: string): Promise<string>
}

/** A socket handed to the runtime with acceptWebSocket (hibernation API). */
export interface HibernatableWebSocket extends WebSocket {
  serializeAttachment(value: unknown): void
  deserializeAttachment(): unknown
}

export interface DurableObjectState {
  readonly id: { toString(): string; readonly name?: string }
  readonly storage: DurableObjectStorage
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
  waitUntil(promise: Promise<unknown>): void
  /** Hibernation API: the runtime keeps the socket open while the object sleeps. */
  acceptWebSocket(socket: WebSocket, tags?: string[]): void
  getWebSockets(tag?: string): HibernatableWebSocket[]
  getTags(socket: WebSocket): string[]
  abort(reason?: string): void
}
