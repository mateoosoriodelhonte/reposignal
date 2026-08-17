# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Changes to scoring rules are called out separately, because they affect how
results should be interpreted rather than how the software behaves. Every
analysis records the `scoringVersion` it was produced under.

## [Unreleased]

### Added

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
