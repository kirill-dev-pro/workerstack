# Sign-in with Klaud

Klaud (klaud.me) is an OpenID Connect provider that admits the members of a
group: a Telegram chat, a Discord server, a Patreon tier, a GitHub or GitLab
organization, or anyone with a link.

## Connect

`klaud connect` creates the group and the application after one approval in
the browser and writes the credentials to `.env`. `workerstack dev` serves on
port 5173 (or the next free one), which the CLI cannot read from
`workerstack dev`, so pass the redirect explicitly:

```sh
bunx @kcrz/klaud connect --access telegram \
  --redirect http://localhost:5173/api/auth/callback/klaud --json
```

It prints an approval link (`authorization_required`): hand it to the person
and wait. It writes `KLAUD_ISSUER`, `KLAUD_CLIENT_ID`, and
`KLAUD_CLIENT_SECRET` to `.env`, and a binding with no secret to
`.klaud/app.json`, which is committed. The client secret is shown exactly
once; never print `.env`.

## Backend

Declare the variables and add the provider. List the endpoints: discovery
fetches while Better Auth initializes, and in a Worker that hangs every
`/api/auth` call.

```ts
import { genericOAuth } from 'better-auth/plugins'

export const backend = workerstack({
  env: {
    server: {
      APP_URL: v.optional(v.string(), 'http://localhost:5173'),
      KLAUD_ISSUER: v.string(),
      KLAUD_CLIENT_ID: v.string(),
      KLAUD_CLIENT_SECRET: v.string(),
    },
  },
  auth: ({ env }) => ({
    baseURL: env.APP_URL,
    advanced: { database: { generateId: () => false } },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: 'klaud',
            authorizationUrl: `${env.KLAUD_ISSUER}/api/auth/oauth2/authorize`,
            tokenUrl: `${env.KLAUD_ISSUER}/api/auth/oauth2/token`,
            userInfoUrl: `${env.KLAUD_ISSUER}/api/auth/oauth2/userinfo`,
            clientId: env.KLAUD_CLIENT_ID,
            clientSecret: env.KLAUD_CLIENT_SECRET,
            // Better Auth creates no account without an email.
            scopes: ['openid', 'profile', 'email'],
          },
        ],
      }),
    ],
  }),
  // ...
})
```

Keep `emailAndPassword` enabled only if the product wants it besides Klaud.

## Sign-in button

```ts
await signIn.social({ provider: 'klaud', callbackURL: '/notes' })
```

## Production

Once the project exists on Bunderhost, its host is known
(`<slug>.<apps zone>` on Cloudflare). Register its callback next to the local
one, then give the three variables to Bunderhost through a setup session
(see shipping):

```sh
bunx @kcrz/klaud add-url https://<host>/api/auth/callback/klaud --json
```

`klaud doctor --json` checks the whole chain: binding, env, discovery, client,
and redirect URLs. `klaud remove-url <url>` removes a callback the app no
longer serves.
