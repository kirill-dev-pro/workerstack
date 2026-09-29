# Verification contract

Run these gates from the application root after changing dependencies,
configuration, or application code:

```sh
bun install
bun test
bun run typecheck
bun run build
bun run blueprint
bun run blueprint:check
```

`bun run blueprint` generates the committed `workerstack.blueprint.yaml` from
the configured Workerstack entry. Set `package.json#workerstack.entry` when the
entry is not `src/workerstack.ts`. `bun run blueprint:check` must pass in CI so
the committed declaration matches the application. Commit only the blueprint:
`wrangler.json` is generated from it and git-ignored. `workerstack dev`
regenerates both on startup and on each change, and `workerstack build` fails
on a stale blueprint, then builds `dist/server` and `dist/client`.

Before production, generate and commit the Drizzle `migrations/` folder.
`provision(app)` from `workerstack/provision` only applies committed
migrations and never imports drizzle-kit. For the local schema-push loop, import
`provision` from `workerstack/provision-schema`; that development-only
entrypoint requires drizzle-kit. Keep the generated migrations, blueprint,
tests, worker entry, API mount, and deployment scripts under version control;
never commit secrets, databases, uploads, or build output.
