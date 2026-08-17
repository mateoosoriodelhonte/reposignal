# Local development

## Requirements

- **Node.js 22.22.2 or newer** (`jsdom` 30 sets that floor)
- npm 10 or newer
- PostgreSQL — **optional**, see [Database](#database)

## Setup

```bash
git clone https://github.com/mateoosoriodelhonte/reposignal.git
cd reposignal
npm install
cp .env.example .env.local
```

### GitHub token

RepoSignal reads only public data, so the token needs **no scopes at all**. Its
only purpose is raising the rate limit from 60 to 5,000 requests per hour.

The quickest way, if you have the GitHub CLI:

```bash
echo "GITHUB_TOKEN=$(gh auth token)" >> .env.local
```

Otherwise create one at [github.com/settings/tokens](https://github.com/settings/tokens)
with **no scopes selected** and add it to `.env.local`.

The token is read on the server only. It never reaches the browser bundle and
is never logged — there is a test asserting it appears in no thrown error,
stack, serialization, or log line.

### Run it

```bash
npm run dev
```

Open http://localhost:3000 and analyze something.

## Database

**RepoSignal runs without a database.** With no `DATABASE_URL`, it falls back
to an in-memory store and logs that it has done so. Everything works; cached
analyses just do not survive a restart.

To use PostgreSQL:

```bash
# Any Postgres will do. With Docker:
docker run --name reposignal-db -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 -d postgres:17

# Point .env.local at it, then:
npm run db:migrate
```

`prisma generate` runs from `postinstall`; `npm run db:studio` opens Prisma
Studio if you want to look at stored analyses.

## Commands

| Command                         | What it does                           |
| ------------------------------- | -------------------------------------- |
| `npm run dev`                   | Development server                     |
| `npm run build`                 | Production build                       |
| `npm start`                     | Serve the production build             |
| `npm run analyze -- owner/repo` | Run the real pipeline from the CLI     |
| `npm test`                      | Unit, integration, and component tests |
| `npm run test:watch`            | Tests in watch mode                    |
| `npm run test:coverage`         | Tests with coverage thresholds         |
| `npm run test:e2e`              | Playwright, against a production build |
| `npm run lint`                  | ESLint                                 |
| `npm run typecheck`             | `next typegen && tsc --noEmit`         |
| `npm run format`                | Prettier, writing changes              |
| `npm run format:check`          | Prettier, checking only                |

### Checking behaviour against the live API

```bash
export GITHUB_TOKEN=$(gh auth token)
npm run analyze -- facebook/react
```

```
react/react
Engineering health: 86 / 100 (medium confidence)

  Repository Activity                    80
  Pull Request Health                    87
  Issue Health                           75
  CI Health                              99
  Documentation                          90
  Repository Hygiene                     89
  Security Hygiene                       75

22 GitHub requests in 4117ms · rate limit remaining: 4699 · scoring version 1.0.0
```

This is the fastest way to see whether a scoring change did what you intended,
and the only thing in the project that talks to the real API.

## Running the E2E suite

```bash
npx playwright install chromium   # first time only
npm run test:e2e
```

Playwright builds the app and serves it with `GITHUB_FIXTURES=1`, which makes
the analysis service return bundled snapshots instead of calling GitHub. Two
fixture repositories exist:

- **`acme/toolkit`** — healthy, scores 96, raises no findings
- **`acme/sparse`** — issues disabled, no pull requests, CI unreadable; exercises
  the partial-data and null-score paths

Any other repository raises the same `not_found` error the real client would,
so the error path is exercised rather than special-cased.

## Environment variables

| Variable                     | Required    | Purpose                                  |
| ---------------------------- | ----------- | ---------------------------------------- |
| `GITHUB_TOKEN`               | Recommended | Raises the rate limit. No scopes needed  |
| `DATABASE_URL`               | No          | PostgreSQL. Falls back to in-memory      |
| `ANALYSIS_FRESHNESS_MINUTES` | No          | Cache window, default 15                 |
| `GITHUB_REQUEST_BUDGET`      | No          | Requests per analysis, default 40        |
| `GITHUB_FIXTURES`            | No          | `1` serves bundled fixtures. Used by E2E |

## Project layout

```
src/
  app/                 routes, server actions, error boundaries
  components/          presentational React components
  lib/
    github/            client, collector, schemas, fixtures
    normalize/         GitHub payloads → domain types
    scoring/           pure scoring, one file per category
    analysis/          orchestration and wiring
    store/             persistence interface and implementations
    logging/           structured logger
    validation/        the SSRF boundary
  proxy.ts             per-request CSP nonce
  types/               domain types — no GitHub vocabulary
tests/
  unit/ integration/ components/ e2e/ support/
```

## Before opening a pull request

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run build
```

CI runs all of these plus Playwright. See [CONTRIBUTING.md](../CONTRIBUTING.md)
for the rules a change has to respect.

## Troubleshooting

**`EBADENGINE` warning on install** — you are below Node 22.22.2. Upgrade;
`jsdom` 30 requires it.

**Every analysis fails with `rate_limited`** — no token, so you have GitHub's
unauthenticated 60/hour limit. Add one to `.env.local`.

**`prisma generate` complains about `DATABASE_URL`** — it should not; the
config only declares a datasource when the variable is set. If it does, check
`prisma.config.ts` has not been edited to use Prisma's `env()` helper, which
treats a missing variable as fatal.

**Analyses are slow** — expect 3–5 seconds for a large repository on a cold
cache. Requests run concurrently within a budget of 40. Repeat visits inside 15
minutes are served from cache.
