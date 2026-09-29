import { QueryClient } from '@tanstack/react-query'
import { createClient } from 'workerstack/query'

import type { App } from './workerstack'

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 10_000 } },
  })
}

export function createApi(queryClient: QueryClient) {
  return createClient<App>({ queryClient })
}

export type AppApi = ReturnType<typeof createApi>
