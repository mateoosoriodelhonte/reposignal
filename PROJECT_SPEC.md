# RepoSignal — Project Specification

> Status: **approved for v1.0** · Scoring algorithm version: `1.0.0`

RepoSignal analyzes a public GitHub repository and produces a transparent,
evidence-backed assessment of its engineering health.

This document is the contract the implementation is held to. It records the
product scope, the architecture, and the rules the scoring engine must obey. It
is deliberately opinionated about what RepoSignal will **not** do, because most
of the credibility of a health score comes from the restraint of its claims.

---

## 1. Product statement

Given `owner/repository` (or a GitHub URL for the same), RepoSignal retrieves
publicly available GitHub data and reports:

- an **overall engineering health score** (0–100, or `null`),
- **seven category scores**, each independently explainable,
- **deterministic findings** with severity, evidence, and a recommendation,
- the **methodology** behind every number, disclosed in the UI itself.

The intended readers are two: an engineer evaluating a dependency or a codebase
they are inheriting, and a non-engineer (hiring manager, engineering manager)
who needs the summary to be honest and legible.

### Non-goals for v1.0

RepoSignal does not, and will not without an explicit scope change:

- analyze private repositories,
- clone, download, execute, or statically analyze repository source code,
- perform vulnerability scanning or claim that a repository is "secure",
- use an LLM to produce, adjust, or justify any score,
- rank repositories against each other or publish a leaderboard.

---

## 2. Core principle: no black-box score

Every number RepoSignal displays must be traceable to raw evidence.

For each category, the UI must be able to answer "how was this calculated?" with:

| Disclosure  | Requirement                                                     |
| ----------- | --------------------------------------------------------------- |
| Metrics     | Every metric examined, with its raw observed value              |
| Weighting   | The weight each metric contributed                              |
| Formula     | The arithmetic, stated plainly                                  |
| Thresholds  | The cutoffs that classified the value, and where they came from |
| Evidence    | A GitHub URL wherever one exists                                |
| Limitations | What this category could not observe, and why                   |

### The unknown-value rule

This is the rule the rest of the system is built around:

> **Missing data is not evidence of poor health.**

A metric that could not be observed is `null`. A category with insufficient
observed metrics scores `null`, not `0`. A `null` category is **excluded from
the overall score** and its weight is redistributed across the categories that
did produce a score — it never drags the total down.

The UI renders these states distinctly and never as a zero:

- **Unknown** — the data exists but RepoSignal could not retrieve it
- **Insufficient data** — retrieved, but too sparse to score responsibly
- **Not applicable** — the metric does not apply to this repository
- **Unable to verify from public GitHub data** — requires elevated permissions

---

## 3. Scope: the seven categories

| Key             | Category            | Weight | Scores `null` when                         |
| --------------- | ------------------- | ------ | ------------------------------------------ |
| `activity`      | Repository Activity | 15     | No commit or push history retrievable      |
| `pullRequests`  | Pull Request Health | 15     | Repository has never had a pull request    |
| `issues`        | Issue Health        | 15     | Issues are disabled on the repository      |
| `ci`            | CI Health           | 15     | No workflows **and** no commit statuses    |
| `documentation` | Documentation       | 15     | Never — file presence is always observable |
| `repository`    | Repository Hygiene  | 15     | Never — file presence is always observable |
| `security`      | Security Hygiene    | 10     | Never — file presence is always observable |

Weights total 100. They are declared once, in `src/lib/scoring/weights.ts`, and
the overall engine renormalizes over whichever categories returned a number.

### 3A. Repository Activity

Observes repository age, last push, commit cadence over the trailing year,
release cadence, latest release recency, and contributor count where the API
exposes it. Detects apparent inactivity, irregular release cadence, and healthy
sustained development.

### 3B. Pull Request Health

Observes open PR count, open PR age distribution, stale PRs, recently merged
PRs, and approximate merge velocity from a bounded sample of recent PRs.

Reports observable behavior only. RepoSignal never claims a cause: a long-lived
open PR is reported as long-lived, not as "neglected".

### 3C. Issue Health

Observes open issues, issue age distribution, stale issues, recent issue
creation, and recent closures.

**Critical correctness requirement:** GitHub's Issues REST API returns pull
requests as issues. Every issue query must discard any payload carrying a
`pull_request` key. This is enforced in normalization and covered by a
regression test.

### 3D. CI Health

Observes the presence of GitHub Actions workflows, the recent conclusion
distribution of workflow runs, repeated-failure signals, and commit-status
checks on the default branch.

Unavailable CI information is `null`, never a failure. A repository with no CI
configured is a _finding_, scored on configuration absence — not a run failure.

### 3E. Documentation

Observes the presence and size of `README`, `CONTRIBUTING`, `LICENSE`,
`SECURITY`, `CODE_OF_CONDUCT`, issue templates, PR templates, and a docs
directory. Deterministic presence-based rules; no natural-language quality
judgment of prose.

### 3F. Repository Hygiene

Observes `.gitignore`, dependency lockfiles, automated dependency management
(Dependabot / Renovate config), `CODEOWNERS`, release tags, and topics/description
metadata. Branch protection requires elevated permissions on most repositories
and is reported as **unable to verify** when the API refuses it.

### 3G. Security Hygiene

Deliberately named _hygiene_, not _score_, because RepoSignal observes practices,
not security posture. Observes `SECURITY.md`, dependency update automation, a
committed lockfile, and security scanning steps declared in workflow files.

No invasive scanning. No credential hunting. No claim that a repository is secure.

---

## 4. Findings engine

Findings are deterministic: identical snapshots produce identical findings.

```ts
interface Finding {
  id: string; // stable dotted id, e.g. "issues.stale.backlog"
  category: CategoryKey;
  severity: 'info' | 'low' | 'medium' | 'high';
  title: string;
  explanation: string; // what was observed and why it matters
  metric: Record<string, number | string | null>;
  recommendation: string;
  confidence: 'low' | 'medium' | 'high';
  evidenceUrl?: string; // deep link into GitHub where one exists
}
```

Finding ids are stable across releases so they can be referenced in
documentation and tests. Severity reflects the observation's significance, and
confidence reflects how completely the underlying data was observed — a finding
derived from a truncated sample is `medium` confidence at best.

---

## 5. Scoring engine contract

Scoring is pure: `(snapshot, now) => CategoryScore`. No I/O, no clock access, no
randomness. `now` is injected so results are reproducible in tests.

```ts
interface CategoryScore {
  score: number | null; // 0–100, or null for insufficient data
  confidence: 'low' | 'medium' | 'high';
  metrics: Metric[];
  findings: Finding[];
  explanation: ScoreExplanation; // formula, weights, thresholds, limits
}
```

Every analysis records `scoringVersion` so historical results stay interpretable
after the rules evolve. A change to any threshold, weight, or formula requires a
version bump and a `docs/SCORING.md` entry.

---

## 6. Architecture

```
GitHub REST API
      │
      ▼
GitHub Data Client        transport: auth, retry, timeout, rate limits, ETags
      │
      ▼
Normalization Layer       GitHub payloads → internal domain types
      │
      ▼
RepositorySnapshot        the only input the scoring engine ever sees
      │
      ├──────────────┐
      ▼              ▼
Metrics Engine   Findings Engine
      │              │
      └──────┬───────┘
             ▼
      Scoring Engine      pure functions, per category, then overall
             │
             ▼
      AnalysisResult      versioned, serializable, cacheable
             │
             ▼
            UI            renders only; calculates nothing
```

Two boundaries are non-negotiable:

1. **GitHub response shapes never escape the normalization layer.** Nothing
   downstream of `normalize/` may reference a GitHub-specific field name.
2. **The UI performs no health calculation.** It renders `AnalysisResult`. If a
   number appears on screen, the scoring engine produced it.

### Project structure

```
src/
  app/                      Next.js routes (UI + route handlers)
  components/               presentational React components
  lib/
    github/                 API client, transport, errors, rate limiting
    normalize/              GitHub payloads → domain types
    scoring/                pure scoring functions, one file per category
    findings/               finding constructors and catalog
    analysis/               orchestration: fetch → normalize → score
    store/                  persistence interface + in-memory/Prisma impls
    logging/                structured server logging
    validation/             Zod schemas for external input
  types/                    shared domain types
tests/
  unit/  integration/  components/  e2e/
```

---

## 7. Technology decisions

| Concern     | Choice                       | Rationale                                             |
| ----------- | ---------------------------- | ----------------------------------------------------- |
| Framework   | Next.js 16 (App Router)      | Server rendering keeps analysis off the client        |
| Language    | TypeScript, strict           | Typed boundaries are the point of the architecture    |
| Styling     | Tailwind CSS v4              | No design-system dependency for a report-shaped UI    |
| Data        | GitHub REST                  | Sufficient for v1; GraphQL only where it clearly wins |
| Validation  | Zod                          | Untrusted input is parsed, not cast                   |
| Persistence | PostgreSQL + Prisma          | Analysis caching and history need a real schema       |
| Testing     | Vitest, RTL, Playwright, MSW | Network is mocked; CI never touches live GitHub       |
| CI          | GitHub Actions               | lint, typecheck, unit, integration, build, E2E        |

**Deliberately not used**, and why:

- **Octokit** — the client needs bespoke rate-limit accounting, ETag reuse, and
  budget-aware pagination. A thin typed `fetch` wrapper is smaller, fully
  mockable, and makes those policies explicit instead of inherited.
- **A charting library** — the charts are static distributions. Server-rendered
  SVG ships zero client JavaScript and is trivially made accessible.
- **Next.js Cache Components** — RepoSignal owns a Postgres-backed analysis
  cache with domain-specific freshness rules. A second caching model would
  duplicate that responsibility.
- **Redis / queues / microservices** — no current requirement justifies them.

---

## 8. Data model

Repository identity is the immutable GitHub numeric `id`, not `owner/name`,
because repositories get renamed and transferred. `owner/name` is a mutable
lookup key that points at that identity.

- `Repository` — identity, current owner/name, GitHub numeric id
- `Analysis` — one analysis run: overall score, `scoringVersion`, timestamps,
  the serialized snapshot, and the completeness of the data it was built from
- `CategoryScore` — per-category score, confidence, metrics, explanation
- `Finding` — findings attached to an analysis

Analyses are append-only. Re-analysis creates a new row; nothing is mutated in
place. This gives historical score tracking for free later, and means a cache
read is just "most recent analysis newer than the freshness window".

---

## 9. Rate limiting and caching

GitHub's API is a shared resource and RepoSignal must be a good citizen.

- **Freshness window:** a cached analysis younger than 15 minutes is served
  directly. Manual refresh is available and separately rate limited.
- **Request budget:** each analysis has a hard cap on GitHub requests. Pagination
  stops at the budget, and any resulting sample truncation is recorded on the
  snapshot and lowers the affected category's confidence.
- **Deduplication:** concurrent analyses of the same repository share one
  in-flight promise.
- **Rate limits:** `x-ratelimit-remaining` is tracked. On `403`/`429` with a
  reset header, RepoSignal fails clearly with the reset time rather than
  retrying into the wall.
- **Retries:** only idempotent GETs, only on 5xx and network errors, capped,
  with exponential backoff and jitter.
- **Timeouts:** every request is abortable.

The UI always shows data freshness ("Analyzed 7 minutes ago").

---

## 10. Security requirements

- Repository input is parsed by Zod into `owner/repository` before any request.
  Only `api.github.com` is ever contacted — the URL is constructed from
  validated components, never taken from user input. This is the SSRF boundary.
- The GitHub token is server-only, never sent to the client, never logged.
- Repository-controlled strings (descriptions, titles, topics) are rendered as
  text. No `dangerouslySetInnerHTML` anywhere in the codebase.
- External links carry `rel="noopener noreferrer"`.
- Security headers are set in `next.config.ts`, including a CSP.
- Analysis endpoints are rate limited per client.
- Errors are mapped to safe messages; stack traces never reach a response.
- Database access goes through Prisma's parameterized queries.

---

## 11. Observability

Structured JSON logs to stdout, one event per line, correlated by `analysisId`:

`analysis_started` · `analysis_completed` · `analysis_failed` ·
`github_request_failed` · `rate_limit_reached` · `cache_hit` · `cache_miss`

Tokens, headers, and full payloads are never logged.

---

## 12. Accessibility

Semantic HTML, keyboard-navigable interactive elements, visible focus states,
labelled form controls, WCAG AA contrast, and a text alternative for every
chart. Score is never communicated by color alone — it always carries a number
and a text label.

---

## 13. Delivery plan

Work is tracked as GitHub issues against the **RepoSignal v1.0** milestone, each
delivered on a feature branch through a reviewed pull request with CI green.

Order of delivery is dependency-driven: transport and normalization first, then
scoring per category, then persistence, then UI, then the test and documentation
passes that harden the whole.

`v0.1.0` is tagged when the analysis pipeline works end to end.
`v1.0.0` is tagged when all seven categories, the full test suite, CI, and the
documentation set are complete and deployed.

---

## 14. Roadmap beyond v1.0

Explicitly out of scope now, recorded so the boundary is intentional:
repository comparison, organization dashboards, historical score tracking UI,
score-change alerts, private repositories via a GitHub App, scheduled analyses,
shareable reports, a public API, README score badges, benchmark cohorts, and an
optional AI executive summary that rephrases finished findings without ever
altering a score or inventing evidence.
