# Compatibility audit

Run every check, record each hit with its file, then give one verdict. A
single blocker makes the verdict **Blocked**, however small the rest is.

## Why these limits exist

Workerstack code runs in a Worker isolate: Web APIs plus `nodejs_compat`, no
`Bun.*`, no file system, no child processes, no native modules, no raw TCP,
about 128 MB of memory, limited CPU per request. Jobs and cron run in the
Scheduler Durable Object, not in a worker process. The database is SQLite
(libsql locally, Turso when hosted).

## Code checks

Run from the application root, over `src/` and `scripts/` (scripts run with
Bun on a laptop and may keep Bun APIs; only code the app imports at runtime
counts). Hits in `*.test.ts` do not count either: `bun test` runs them in
Bun.

```sh
grep -rnE "Bun\.(WebView|spawn|spawnSync|\\\$)|puppeteer|playwright|chromium|child_process" src
grep -rnE "Bun\.sql|Bun\.SQL|bun:sqlite|postgres-js|bun-sql|pglite|mysql2?|from 'pg'" src
grep -rnE "from '(sharp|canvas|better-sqlite3)'|\.node'" src
grep -rnE "Bun\.(file|write)|from 'node:fs|readFileSync|writeFile|createReadStream" src
grep -rnE "Bun\.(sleep|CryptoHasher|hash|password|Image|serve)" src
grep -rnE "nodemailer|email-smtp|smtp" src
grep -rnE "transforms: *true|\?(w|width|h|height|fit)=" src
grep -rnE "maxSize: *'[0-9]{3,}mb'|arrayBuffer\(\)" src
grep -rnE "timeout: *[0-9]{6,}|maxRuntime|stream(Text|Object)|for await" src
grep -rnE "discoveryUrl|discovery" src
grep -E '"bunderstack": *"' package.json
```

| Hit                                                                                              | Verdict | Why / what to do                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Headless browser (`Bun.WebView`, puppeteer, playwright, Chrome), `Bun.spawn`, `child_process`    | Blocked | An isolate cannot start a process. Needs a separate service; stay on 0.x.                                                                                                                                                                                    |
| Postgres, MySQL, `Bun.sql`, `bun:sqlite`, PGlite, connections to user databases                  | Blocked | Workerstack is SQLite over libsql only, and an isolate has no raw TCP or disk.                                                                                                                                                                               |
| Native modules (`sharp`, `canvas`, `.node` files)                                                | Blocked | No native code in an isolate.                                                                                                                                                                                                                                |
| `Bun.file` / `node:fs` in `src/server.ts` serving `dist/client`                                  | Go      | Delete the file: the Worker entry serves static assets.                                                                                                                                                                                                      |
| `Bun.file` / `node:fs` reading or writing app data at runtime (uploads dir, exports, caches)     | Rework  | Move the data to a storage bucket.                                                                                                                                                                                                                           |
| `Bun.sleep`, `Bun.CryptoHasher`, `Bun.hash`                                                      | Rework  | `await new Promise((r) => setTimeout(r, ms))`; `crypto.subtle.digest`. Small and local.                                                                                                                                                                      |
| `Bun.password`                                                                                   | Rework  | Better Auth hashes passwords itself; use it, or `crypto.subtle`.                                                                                                                                                                                             |
| SMTP (`nodemailer`, `workerstack/email-smtp`)                                                    | Rework  | No raw TCP in production: switch to an HTTP provider such as Resend.                                                                                                                                                                                         |
| `transforms: true` and URLs asking for a width or size                                           | Rework  | Transforms needed `Bun.Image` and are gone. Unused (no size parameters in URLs): just delete the flag.                                                                                                                                                       |
| Files of 100 MB or more read whole (`maxSize` in the hundreds of MB, `arrayBuffer()` on uploads) | Blocked | They do not fit in isolate memory, and direct presigned uploads on the Worker targets are unproven.                                                                                                                                                          |
| Jobs that run for minutes (agent loops, long streams, big imports)                               | Blocked | Durable Object alarm duration is limited on Cloudflare and unmeasured on celld. Ask before assuming it fits.                                                                                                                                                 |
| grammy with the `'bun'` adapter or another Bun HTTP adapter                                      | Rework  | Use the standard `Request -> Response` webhook adapter.                                                                                                                                                                                                      |
| `discoveryUrl` in Better Auth's `genericOAuth` (or any fetch while auth initializes)             | Rework  | Init runs once per isolate and its promise is shared: a request that waits on another request's fetch never answers, so every `/api/auth` call hangs. List `authorizationUrl`, `tokenUrl`, and `userInfoUrl` from the provider's discovery document instead. |
| `bunderstack` older than `0.24`                                                                  | Rework  | The 0.24 breaking changes come with the move: see "Older than 0.24" in code changes.                                                                                                                                                                         |

Also read `package.json` dependencies for libraries that wrap any of the
above (PDF renderers built on a browser, `jsdom`-heavy parsers, native image
libraries). When a library's Workers support is unknown, say it is unverified
rather than guessing.

## Hosting checks

With the Bunderhost MCP tools, `get_project` on the project:

| Condition                                                                                                                                | Verdict | Why                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Moving a Fly or self-hosted project to Cloudflare, organization allowed (`list_deployment_targets` lists `cloudflare`), source on GitHub | Go      | Bunderhost keeps the Turso database and copies the Tigris bucket into R2 under the same keys during the first Cloudflare deploy. |
| Moving to Cloudflare, organization not allowed or source uploaded                                                                        | Blocked | The Cloudflare target is not available to this project. A connected server is the other Worker target.                           |
| `productionTarget: cloudflare`, moving elsewhere                                                                                         | Blocked | Bunderhost does not move a project off Cloudflare.                                                                               |
| `productionTarget: managed_fly` or `self_hosted`, moving to a connected server                                                           | Go      | Worker apps run on a self-hosted server through celld. The Turso database is reused as is.                                       |
| Staying on managed Fly                                                                                                                   | Blocked | Worker apps do not run on managed Fly: choose Cloudflare or a connected server (`create_server`).                                |
| `maxPreviewEnvironments` above 0                                                                                                         | Rework  | Worker previews are not available yet: pull requests stop getting preview environments. Tell the person.                         |
| The bucket holds files and the target is a server                                                                                        | Go      | They stay in the same bucket but must be copied to new keys; see hosting cutover.                                                |

## Report

Give the verdict first, then a table of every hit: file, what it does, why it
blocks or what the rework is. For **Blocked**, end the report there.
