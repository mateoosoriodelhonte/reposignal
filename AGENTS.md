<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# RepoSignal — working rules

Read [PROJECT_SPEC.md](PROJECT_SPEC.md) before changing behavior, and
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Invariants

These are not style preferences. Breaking one makes RepoSignal's output
dishonest, which is the one failure mode the project exists to avoid.

1. **Never coerce missing data to zero.** Unobservable values are `null` with an
   `unknownReason`. A category without enough data returns `score: null`. The
   overall score excludes null categories and redistributes their weight.
2. **GitHub API shapes stay inside `src/lib/github` and `src/lib/normalize`.**
   No file elsewhere may reference a GitHub response field name.
3. **Scoring is pure.** `(snapshot, now) => result`. No I/O, no `Date.now()`, no
   randomness inside scoring functions — `now` is always injected.
4. **The UI calculates nothing.** Components render `AnalysisResult`. A number
   on screen was produced by a tested scoring function.
5. **Scoring changes are versioned.** Any weight, threshold, or formula change
   bumps `SCORING_VERSION` and adds an entry to `docs/SCORING.md`.
6. **Findings state observations, not causes.** RepoSignal cannot observe
   intent, so it never attributes one.
7. **Tests never reach the network.** Unit tests use literals, integration tests
   use MSW, E2E uses bundled fixtures via `GITHUB_FIXTURES=1`.

## Commands

```bash
npm run dev           # development server
npm test              # unit + integration (Vitest)
npm run test:e2e      # Playwright
npm run lint
npm run typecheck     # next typegen && tsc --noEmit
npm run build
```

## Layout

```
src/lib/github/      transport: auth, retry, timeouts, rate limits, budget
src/lib/normalize/   GitHub payloads → domain types (the only translation layer)
src/lib/scoring/     pure scoring, one file per category, plus overall
src/lib/findings/    finding constructors and catalog
src/lib/analysis/    orchestration: fetch → normalize → score
src/lib/store/       persistence interface + in-memory and Prisma implementations
src/types/           domain types — no GitHub vocabulary
```

## TypeScript

`strict`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
Indexed access yields `T | undefined` and must be narrowed; optional properties
must be omitted rather than set to `undefined`.
