// workerstack/durable — the base class of an application's Durable Objects.
//
// In the Worker (the `workerd` export condition) this module is
// `cloudflare:workers`' own DurableObject; see ./workerd.ts. Everywhere else
// (Bun, when `workerstack blueprint` loads src/workerstack.ts and with it the
// class) it is this stand-in of the same shape, so declaring
// `durableObjects: { DOC_ROOM: DocRoom }` never loads Cloudflare's runtime.
import type { DurableObjectState } from './state'

export type {
  DurableObjectSql,
  DurableObjectSqlCursor,
  DurableObjectState,
  DurableObjectStorage,
  HibernatableWebSocket,
} from './state'

export abstract class DurableObject<Env = unknown> {
  protected readonly ctx: DurableObjectState
  protected readonly env: Env

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx
    this.env = env
  }
}
