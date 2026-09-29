// workerstack/start/server-entry — the Worker of a TanStack Start app with SSR.
// The app backend comes from the Vite virtual module that workerstack() resolves.
import { backend } from 'virtual:workerstack/backend'

import { createStartWorker } from './create-start-worker'

const worker = createStartWorker(backend)
export const { Scheduler, RealtimeHub, RateLimiter } = worker.durableObjects
export default worker.handler
