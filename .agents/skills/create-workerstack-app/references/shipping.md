# Shipping to Bunderhost

The app passes its checks locally and is pushed to GitHub. Creating the
project and deploying it each need the person's confirmation; the Bunderhost
MCP tools ask for it.

## 1. Connect the repository

`resolve_repository` with `owner/name`. `repository_connected` gives the
`installationId` for the next step. Otherwise `list_repository_connections`
shows how to install the Bunderhost GitHub App on the repository; the person
does that.

## 2. Create the project

`list_deployment_targets` lists `cloudflare` when the organization may use
it; that is the target for a new Workerstack app. A connected server works
too.

`create_project` with `source: github`, the repository, the
`installationId`, `defaultBranch`, and `productionTarget: cloudflare`. Bunderhost
reads `workerstack.blueprint.yaml`, assigns a slug, and the production host
becomes `<slug>.<apps zone>`. Pushes to the default branch deploy from now on.

## 3. Configure

`get_project_readiness` lists the variables the blueprint declares and which
are missing. Bunderhost itself sets `APP_URL`, `NODE_ENV`, `AUTH_SECRET`, and
the database URLs, and provisions the Turso database and the R2 bucket.

For anything secret (OAuth client secrets, API keys), call
`create_setup_session` and give the person its link; they enter the values in
Bunderhost. Never ask for a secret in chat, and never read it from `.env` to
pass it on.

For Klaud, register the production callback first (see sign-in with Klaud).

## 4. Deploy

`deploy_revision` with the exact 40-character commit SHA that is on GitHub.
Follow `get_deployment` and `get_deployment_logs`: the build, the wrangler
check, the migrations, `uploading Worker`, and `live at https://…`. Report it
live only when the deployment is terminal and readiness is `ok`.

## 5. Verify

A new host needs a minute or two for its certificate; until then curl fails
with exit code 35. If `dig` resolves the host but curl cannot, the local
resolver cached an earlier miss: pass `--resolve <host>:443:<ip>`.

- `/api/health` is `200`; `/api/readiness` reports `database` and `schema` as
  `ok`.
- The landing page renders in a browser, with no console errors.
- `/api/auth/get-session` answers at once.
- For an OAuth provider, sign-in reaches the provider without an account:

  ```sh
  curl -s -X POST https://<host>/api/auth/sign-in/social \
    -H 'content-type: application/json' -H 'origin: https://<host>' \
    -d '{"provider":"klaud","callbackURL":"/","disableRedirect":true}'
  ```

  The `url` it returns must carry the production callback, and requesting it
  must redirect to the provider's login page.

Creating accounts and rows in production is the person's to do. Put the live
URL in the README and the agent docs.

## Later

- An admin is appointed in Bunderhost (the project's Users tab), not in the
  app.
- A custom domain is attached in Bunderhost; Cloudflare routes it to the same
  Worker, and `APP_URL` follows it once it is live.
- Preview environments are not available for Worker apps yet.
