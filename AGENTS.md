# Workerstack

A full-stack framework for Cloudflare Workers. See README.md for the shape of
an app and `docs/superpowers/specs/` for the design of the Workers runtime,
the blueprint, and SSR.

## Conventions

- Bun is the toolchain: `bun install`, `bun test`, `bun run <script>`,
  `bunx <package>`. Application code runs on workerd, so library runtime code
  must not call Bun APIs (`scripts/dependency-boundaries.test.ts` enforces an
  allowlist for tooling: the CLI, dev, and testing).
- SQLite only (libsql, Turso). Internal table names (`bunderstack_file_meta`,
  `_bunderstack_*`) are an on-disk format shared with hosts; do not rename
  them.
- The blueprint (`workerstack.blueprint.yaml`) is the source of truth for
  hosting; `wrangler.json` is generated from it.
- Delegate migrations to drizzle-kit.
- After a runtime change run `bun run test:workers` (celld) and
  `bun run test:workers -- --runtime workerd`.

## Packages are consumed as built `dist`

`packages/*/package.json` publishes `dist/*.js` + `dist/*.d.ts`, never `src`, so
a consumer's compiler flags apply to our declarations rather than our sources.
Consequences when working in this repo:

- `bun run build` (also run by `prepare` on install and `prepack` on publish)
  compiles the package. Examples and any app resolve
  the packages through `dist`, so a library change needs a rebuild to be visible
  outside its own package. Package tests import relative paths and do not.
- `bun run verify:consumer` packs the tarballs, installs them into a throwaway
  app with the strictest common flags and `skipLibCheck: false`, and fails if any
  diagnostic points at our packages. Run it after touching public types.
- Avoid returning types inferred from a dependency's generics from an exported
  function: declaration emit inlines those generics by name, and unbound names
  silently degrade the published type. State the type instead — see
  `createAuth` and the CRUD schema casts in `api/crud-router.ts`.
