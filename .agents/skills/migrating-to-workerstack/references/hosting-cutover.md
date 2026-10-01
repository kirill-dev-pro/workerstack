# Hosting cutover in Bunderhost

The code branch is verified and not merged. Everything below changes
production: confirm each numbered step with the person before doing it.

## What carries over

- **Database**: the environment's Turso database is reused as is. The schema
  and the internal tables do not change, so there is no data migration.
- **Environment variables and secrets**: the project's values carry over.
  Bunderhost sets `APP_URL`, `NODE_ENV`, `AUTH_SECRET`, and the database URLs
  itself.
- **Files**: on Cloudflare, Bunderhost copies the Tigris bucket into R2
  itself. On a server, the Tigris bucket is reused under a new key layout
  (step 4).
- **Not carried over**: preview environments (Worker previews do not exist
  yet) and the hostname when the target changes.

## 1. Choose and set the target

Worker apps run on Cloudflare or on a connected server (celld).
`list_deployment_targets` shows what the organization has; with neither,
connect a server with `create_server` first.

The target cannot be changed through MCP. The person sets it in the
dashboard: the project's settings, deployment target, then Cloudflare Workers
or their server. Nothing is created or stopped then: the next production
deployment performs the switch. Without a custom domain the old target is
destroyed as soon as the new one serves; with one, it keeps serving until the
domain verifies on the new target.

On Cloudflare that deployment also creates an R2 bucket named like the
Tigris one, copies every file into it before the upload, copies again after
cutover for files uploaded meanwhile, and only then points the project at R2.
A failed copy fails the deployment and leaves the old target serving. The
Tigris bucket is never deleted: the nightly reaper lists it as an unclaimed
production resource for the person to delete.

A project already on a server can stay on the same server; skip this step.

## 2. Prepare for the new hostname

The live URL changes with the target (for example from
`bh-<slug>-prod.fly.dev` to `<slug>.<vps zone>`), unless a custom domain is
attached. Before the deployment, list with the person:

- OAuth callback URLs at identity providers (Google, GitHub, Klaud, ...):
  add `https://<new host>/api/auth/callback/<provider>` next to the old one;
- webhook URLs (Telegram bots, Stripe, GitHub apps);
- hard-coded origins in code, env values, CORS lists, Better Auth
  `trustedOrigins` and `baseURL` fallbacks, and docs;
- headers of the old platform, such as `fly-client-ip` in Better Auth's
  `ipAddressHeaders`: behind the server's proxy the client address arrives in
  `x-forwarded-for`.

## 3. Merge and deploy

Merge the branch into the default branch. With `deployTrigger: push` the push
deploys; with `manual` or `release`, `deploy_project` after the person
confirms. The revision's `workerstack.blueprint.yaml` sends it down the Worker
path even though the project still reads as a 0.x one: Bunderhost marks the
project as a Worker app, builds with Bun in Docker, validates the bundle (with
celld for a server, wrangler for Cloudflare), runs the committed migrations,
and cuts over.

Follow it with `get_deployment` and `get_deployment_logs`. Report it live only
when the deployment is terminal and `get_project_readiness` is `ok`.

## 4. Copy the files (server target only)

Skip this step on Cloudflare: the deployment copied the files.

A 0.x app stored a file with id `<bucket>/<name>` at the object key
`<bucket>/<name>`. celld stores a Worker's R2 bucket under
`celld/r2/<appName>-<bucket>/`, so the same file id resolves to
`celld/r2/<appName>-<bucket>/<bucket>/<name>`. `<appName>` is the
environment's app name (for example `bh-<slug>-prod`); `<bucket>` is each
logical bucket in the backend's `storage.buckets`.

Until the copy runs, existing files return `404` on the Worker. The bucket
credentials never go through the agent: the person runs the copy as root on
the server, where the first Worker deployment wrote them to
`/etc/bunderhost/<appName>/celld.env`. Copy one file first and open it through
the app (`/api/files/<bucket>/<name>`), then copy the rest:

```sh
APP=bh-<slug>-prod            # environment app name
BUCKET=bh-<slug>-prod         # the Tigris bucket (get_project resources)
LOGICAL=photos                # repeat for each logical bucket
docker run --rm --env-file /etc/bunderhost/$APP/celld.env --entrypoint sh amazon/aws-cli -c \
  "aws --endpoint-url \"\$S3_ENDPOINT\" s3 cp --recursive \
   s3://$BUCKET/$LOGICAL/ s3://$BUCKET/celld/r2/$APP-$LOGICAL/$LOGICAL/"
```

The old keys stay in place, so the 0.x deployment keeps working for a
rollback. Uploads made after the copy exist only under the new layout.

## 5. Verify

- The public pages and `/api/health` answer on the new hostname.
- Sign in through each provider (this proves the callback URLs).
- One write through the app, and one existing file opens.
- `get_runtime_logs` is free of errors for a few minutes; cron jobs appear in
  the logs at their schedule.

Then update the docs (live URL, callback URLs) and remove the old callback
URLs once the person agrees.

## Rollback

Revert the merge on the default branch and set the target back to the old one
in the dashboard; the next deployment restores the 0.x app on the same
database. Files uploaded after the cutover live only under the celld layout
and are invisible to the 0.x app until copied back.
