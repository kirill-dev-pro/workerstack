import { workerstackStart } from 'workerstack/start'

import type { App } from './workerstack'

export const { createQueryClient, createApi } = workerstackStart<App>()
export const queryClient = createQueryClient()
export const api = createApi(queryClient)
