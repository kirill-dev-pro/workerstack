import * as v from 'valibot'
// The backend of the DocRoom recipe: auth, and the declaration of the room's
// Durable Object class. src/server.ts routes to it (see
// docs/recipes/durable-objects.md).
import { workerstack } from 'workerstack'
import { libsql } from 'workerstack/libsql'

import { DocRoom } from './doc-room'
import * as schema from './schema'

export const backend = workerstack({
  schema,
  database: { adapter: libsql() },
  auth: ({ env }) => ({
    baseURL: env.APP_URL,
    emailAndPassword: { enabled: true },
    advanced: { database: { generateId: () => false } },
  }),
  env: {
    server: { APP_URL: v.optional(v.string(), 'http://127.0.0.1:8787') },
  },
  // One namespace of DocRoom objects, reached through env.DOC_ROOM.
  durableObjects: { DOC_ROOM: DocRoom },
})
