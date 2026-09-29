// workerstack/workers/entry — the Worker of an SPA. The app backend comes from
// the Vite virtual module that workerstack() resolves.
import { backend } from 'virtual:workerstack/backend'

import { createWorker } from './index'

const worker = createWorker(backend)
export const { Scheduler, RealtimeHub, RateLimiter } = worker.durableObjects
export default worker.handler
