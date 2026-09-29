# Changelog

## 0.1.0-beta.1

- The first request in an isolate starts the Scheduler, so jobs and cron run
  on hosts that create no Cron Triggers.

## 0.1.0-beta.0

First release of Workerstack, split from the Workers rewrite of Bunderstack
(`bunderstack@1.0.0-beta.4`). Changes against that release:

- The package, CLI, imports, Vite plugin, and blueprint file are renamed to
  `workerstack` (`workerstack.blueprint.yaml`, `virtual:workerstack/backend`,
  `WORKERSTACK_*` environment variables). Internal table names stay the same.
- SQLite only (libsql locally, Turso when hosted). Postgres, PGlite, and the
  Bun database drivers are removed.
- Image transforms are removed: they need `Bun.Image`, which Workers lack.
