// The app backend that workerstack() resolves in the app's Vite build.
declare module 'virtual:workerstack/backend' {
  import type { WorkerstackBackend } from './backend'

  export const backend: WorkerstackBackend<any>
}

// The application's live Durable Object classes, by class name; workerstack()
// generates the module from the blueprint so the package entries export them.
declare module 'virtual:workerstack/durable-objects' {}

// Only src/durable/workerd.ts imports it, in the Worker build.
declare module 'cloudflare:workers' {
  export abstract class DurableObject<Env = unknown> {
    protected readonly ctx: import('./durable/state').DurableObjectState
    protected readonly env: Env
    constructor(ctx: import('./durable/state').DurableObjectState, env: Env)
  }
}
