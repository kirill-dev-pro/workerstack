// The app backend that workerstack() resolves in the app's Vite build.
declare module 'virtual:workerstack/backend' {
  import type { WorkerstackBackend } from './backend'

  export const backend: WorkerstackBackend<any>
}
