# Deployment

RepoSignal is deployed on Vercel at
[reposignal-lovat.vercel.app](https://reposignal-lovat.vercel.app).

## Current configuration

| Setting               | Value       | Notes                                 |
| --------------------- | ----------- | ------------------------------------- |
| Platform              | Vercel      | Free tier                             |
| `GITHUB_TOKEN`        | **not set** | See below                             |
| `DATABASE_URL`        | not set     | Falls back to the in-memory store     |
| Deployment protection | disabled    | The demo has to be publicly reachable |

## Why the demo has no GitHub token

RepoSignal needs a token with **no scopes** — it reads only public data, and a
token exists solely to raise the rate limit from 60 to 5,000 requests an hour.

The token available on the machine that deployed this carries `repo` and
`workflow` **write** scopes. Putting a credential that can write to
repositories into a public web service, when the service needs none of that
access, is not a trade worth making for a demo. So the deployment runs
unauthenticated.

The practical consequence: each analysis costs roughly 22 requests, so the
demo can serve a couple of analyses per hour per edge region before GitHub
rate limits it. Cached analyses are still served. Under load, visitors may see
the rate-limit state — which is at least an honest demonstration of that
error path.

### Adding a token

This is the one step that needs a human, because GitHub no longer allows
creating personal access tokens through its API.

1. Create a token at [github.com/settings/tokens](https://github.com/settings/tokens)
   with **no scopes selected at all**.
2. Add it to the project:

   ```bash
   vercel env add GITHUB_TOKEN production
   # paste the token when prompted
   vercel deploy --prod
   ```

That raises the demo to 5,000 requests an hour.

## Adding a database

Optional. Without `DATABASE_URL`, analyses are cached in memory, which on
serverless means per-instance and short-lived — visitors mostly get fresh
analyses.

Any hosted PostgreSQL works. Set `DATABASE_URL` as a production environment
variable, then run the migration against it:

```bash
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

## Verified after deployment

- Homepage and analysis routes reachable without authentication
- Real repositories analyzed correctly in production
  (`prisma/prisma` 91, `vercel/next.js` 82)
- Security headers present on the deployed origin, including the per-request
  CSP nonce, and with `'unsafe-eval'` correctly absent in production
- Partial-data path working: branch protection reported as unretrievable and
  excluded rather than counted against the repository

## Redeploying

```bash
vercel deploy --prod
```

The `main` branch is not auto-deployed; deployment is deliberate.
