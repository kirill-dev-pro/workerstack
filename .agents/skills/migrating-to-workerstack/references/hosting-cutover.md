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

The target cannot be changed through MCP, and `get_project` does not show a
pending one: ask the person to set it and to tell you when it is done. They
set it in the dashboard: the project's settings, deployment target, then
Cloudflare Workers or their server. Nothing is created or stopped then: the next production
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

The live URL changes with the target unless a custom domain is attached, and
the new one is known before the deploy: `<slug>.<apps zone>` on Cloudflare
(for example `my-app-ab12.apps.kcrz.dev`), `<slug>.<vps zone>` on a server.
Before the deployment, go through with the person:

- OAuth callback URLs at identity providers (Google, GitHub, ...): add
  `https://<new host>/api/auth/callback/<provider>` next to the old one. For
  Klaud, run this in the app's directory; it uses the registration token
  `klaud connect` stored, valid for a month:

  ```sh
  bunx @kcrz/klaud add-url https://<new host>/api/auth/callback/klaud --json
  ```

- webhook URLs (Telegram bots, Stripe, GitHub apps);
- hard-coded origins in code, env values, CORS lists, Better Auth
  `trustedOrigins` and `baseURL` fallbacks, and docs: replace the old host
  with the new one on the branch;
- headers of the old platform, such as `fly-client-ip` in Better Auth's
  `ipAddressHeaders`: on Cloudflare the client address arrives in
  `cf-connecting-ip`, behind a server's proxy in `x-forwarded-for`.

## 3. Merge and deploy

Merge the branch into the default branch. With `deployTrigger: push` the push
deploys; with `manual` or `release`, `deploy_project` after the person
confirms. The revision's `workerstack.blueprint.yaml` sends it down the Worker
path even though the project still reads as a 0.x one: Bunderhost marks the
project as a Worker app, builds with Bun in Docker, validates the bundle (with
celld for a server, wrangler for Cloudflare), runs the committed migrations,
and cuts over.

Follow it with `get_deployment` and `get_deployment_logs`. A move to
Cloudflare logs, in order: the build, `validating the Worker bundle with
wrangler`, `moving bucket … from tigris to R2`, `copied N files to R2`, the
migrations, `uploading Worker`, `live at https://…`, and finally `bucket … now
lives in R2`. Report it live only when the deployment is terminal and the
app's readiness is `ok`.

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

A new host on Cloudflare needs a minute or two for its certificate: until
then curl fails with exit code 35 (a TLS error). Wait for `/api/health`
instead of reporting a failure. If `dig` resolves the host but curl says
`Could not resolve host`, the local resolver cached the answer from before
the deploy; pass `--resolve <host>:443:<ip from dig>`.

- `/api/health` is `200` and `/api/readiness` reports `database` and `schema`
  as `ok`.
- The public pages render in a browser, with no console errors.
- `/api/auth/get-session` answers at once; a hang means something fetches
  while auth initializes (see the audit).
- Sign-in reaches the provider with the new callback, checked without an
  account:

  ```sh
  curl -s -X POST https://<new host>/api/auth/sign-in/social \
    -H 'content-type: application/json' -H 'origin: https://<new host>' \
    -d '{"provider":"<provider>","callbackURL":"/","disableRedirect":true}'
  ```

  The answer's `url` carries `redirect_uri=https://<new host>/api/auth/callback/<provider>`.
  Requesting that `url` must redirect to the provider's login page, not to
  an error about the redirect URI.

- One existing file opens through the app, and `get_runtime_logs` is free of
  errors for a few minutes; cron jobs appear at their schedule.

Do not create accounts or data in production to test it. A full sign-in and
a write are the person's to try.

## 6. Clean up

- Remove the old callback URLs once the old target is gone. A freed
  `*.fly.dev` name can be taken by someone else, and a registered callback
  would send them authorization codes. For Klaud:

  ```sh
  bunx @kcrz/klaud remove-url https://<old host>/api/auth/callback/klaud --json
  ```

- Update the live URL in the README and agent docs.
- After a move to Cloudflare, the person deletes the old Tigris bucket once
  they are satisfied; the reaper only reports it.

## Rollback

From a server: revert the merge on the default branch and set the target back
in the dashboard; the next deployment restores the 0.x app on the same
database. Files uploaded after the cutover live only under the celld layout
and are invisible to the 0.x app until copied back.

From Cloudflare there is no switch back: Bunderhost does not move a project
off Cloudflare, and without a custom domain the old Fly app or server app is
already destroyed. Fix forward, or redeploy an earlier Workerstack revision.
The database and the Tigris copy of the files are still intact.
