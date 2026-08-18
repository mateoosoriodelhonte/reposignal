# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Changes to scoring rules are called out separately, because they affect how
results should be interpreted rather than how the software behaves. Every
analysis records the `scoringVersion` it was produced under.

## [Unreleased]

### Added

- Analyze private repositories through a GitHub App. Read-only, per-repository
  access; the session cookie carries no token; installation tokens are minted
  per use and never persisted; private analyses are never written to the
  shared cache
- The initial database migration, so `prisma migrate deploy` and
  `npm run db:migrate` work on a fresh database

## [1.0.0] - 2026-08-17

Initial release. RepoSignal analyzes a public GitHub repository and reports
engineering health across seven categories, with every score traceable to the
public data it came from.

### Added

- Production deployment at https://reposignal-lovat.vercel.app
- Distribution charts for open issue age, open pull request age, and commit
  activity — server-rendered SVG with an equivalent table for assistive
  technology, omitted entirely where there is too little data to draw one
- Complete documentation: `docs/SCORING.md` documenting every weight,
  threshold, and formula with its rationale and a worked example of weight
  redistribution; `ARCHITECTURE.md`; `docs/LOCAL_DEVELOPMENT.md`; README
  screenshots captured from a real analysis
- Component tests for every UI state, integration tests covering the full
  pipeline with MSW, and a Playwright end-to-end suite running against bundled
  fixtures — 477 unit, integration, and component tests plus 22 end-to-end
  specs
- A malformed repository path now returns a real 404 status rather than
  rendering the not-found page under a 200
- Analysis orchestration with a 15-minute cache freshness window, in-flight
  request deduplication, and invalidation when `scoringVersion` changes
- Persistence: a Prisma/PostgreSQL store keyed on GitHub's immutable numeric
  repository id, with an in-memory fallback so the application runs without a
  database
- Structured JSON logging correlated by analysis id, and per-client rate
  limiting
- Scoring engine (`scoringVersion` 1.0.0): seven pure category scorers —
  activity, pull requests, issues, CI, documentation, repository hygiene, and
  security hygiene — plus the overall engine that renormalizes declared weights
  across whichever categories produced a score. Null categories are excluded
  and their weight redistributed; they never count as zero
- Repository normalization layer: Zod-parsed GitHub payloads mapped into a
  `RepositorySnapshot`, with pull requests excluded from all issue data,
  unobservable values preserved as `null`, sample truncation recorded, and
  per-endpoint failures collected rather than aborting the analysis
- GitHub API client: a typed `fetch` wrapper with bearer auth, per-request
  timeouts, bounded jittered retry on 5xx and network errors only, rate-limit
  accounting with reset times, ETag conditional requests, a hard per-analysis
  request budget, and truncation-aware pagination
- Repository input validation: a Zod-backed parser that accepts `owner/repo`,
  GitHub URLs, deep links, and `git@` remotes, and rejects everything else.
  This is the SSRF boundary — only a validated `{ owner, name }` pair reaches
  URL construction
- Project bootstrap: Next.js 16 App Router, TypeScript in strict mode,
  Tailwind CSS v4
- Engineering standards: ESLint, Prettier, Vitest, Playwright, GitHub Actions CI
- `PROJECT_SPEC.md` recording the approved architecture, scoring contract, and
  product scope
- Core domain types (`AnalysisResult`, `CategoryScore`, `Finding`,
  `RepositorySnapshot`) establishing the null-preserving contract
- Security headers and Content Security Policy
- Contribution, security, and code of conduct documentation

[unreleased]: https://github.com/mateoosoriodelhonte/reposignal/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/mateoosoriodelhonte/reposignal/releases/tag/v1.0.0
