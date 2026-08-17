# Contributing to RepoSignal

Thanks for considering a contribution. This document covers how the project is
built and what a change needs to include to be merged.

## Getting set up

See [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md). The short version:

```bash
npm install
cp .env.example .env.local
echo "GITHUB_TOKEN=$(gh auth token)" >> .env.local
npm run dev
```

## Workflow

1. Find or open an issue describing the work. Issues carry the problem, scope,
   acceptance criteria, and testing expectations — agreeing on those first is
   what keeps pull requests reviewable.
2. Branch from `main` using `type/issue-number-short-description`:

   ```bash
   git switch -c feat/12-analysis-cache
   ```

   Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`.

3. Implement only that issue. Unrelated improvements are their own issue —
   this is not bureaucracy, it is what keeps a diff possible to review.
4. Add or update tests.
5. Run the checks below.
6. Open a pull request referencing the issue, with testing evidence.

## Checks that must pass

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

CI runs all of these plus Playwright. A PR is merged only when CI is green.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add repository analysis cache
fix: exclude pull requests from issue counts
docs: document overall score renormalization
test: cover null propagation in CI scoring
```

Present tense, imperative, no trailing period. The subject line should say what
changed; the body should say why, if it is not obvious.

## The rules a change must respect

These come from [PROJECT_SPEC.md](PROJECT_SPEC.md) and are the constraints that
make RepoSignal's output trustworthy. A PR that breaks one will be asked to
change.

### Never turn missing data into zero

If something could not be observed, it is `null` with an `unknownReason`. A
category with insufficient data returns `score: null`. The overall score
excludes null categories and redistributes their weight. Any PR touching
scoring needs a test proving the null path.

### Keep GitHub's shapes inside `src/lib/normalize`

No file outside `src/lib/github` and `src/lib/normalize` may reference a GitHub
API field name. Downstream code depends on `RepositorySnapshot` only.

### Keep scoring pure

Scoring functions take `(snapshot, now)` and return a result. No I/O, no
`Date.now()`, no randomness. `now` is injected so tests are deterministic.

### The UI calculates nothing

Components render `AnalysisResult`. If a component needs a number that does not
exist yet, add it to the scoring engine with tests, then render it.

### Scoring changes are versioned

Changing any weight, threshold, or formula requires bumping `SCORING_VERSION`
and adding an entry to [docs/SCORING.md](docs/SCORING.md). Stored analyses
record the version they were produced under so historical results stay
interpretable.

### Do not claim more than the data supports

Findings describe observations, not causes. "37 issues have had no activity for
over 180 days" is a finding. "Maintainers are ignoring the backlog" is not —
RepoSignal cannot observe intent.

## Adding a metric or finding

1. Add the observable field to `RepositorySnapshot` as nullable.
2. Populate it in normalization, with a test for the absent case.
3. Add the scoring component, its weight, and its threshold, and document the
   threshold's rationale in `docs/SCORING.md`.
4. Add the finding with a stable dotted id, an evidence URL where one exists,
   and a confidence that reflects sample truncation.
5. Test: the present case, the absent case, and each threshold boundary.

## Testing expectations

| Layer       | Location            | Expectation                                    |
| ----------- | ------------------- | ---------------------------------------------- |
| Unit        | `tests/unit`        | Scoring, normalization, thresholds, null paths |
| Integration | `tests/integration` | Fixtures → normalize → score, network via MSW  |
| Component   | `tests/components`  | Loading, success, partial, error, empty states |
| End-to-end  | `tests/e2e`         | The analysis journey against bundled fixtures  |

No test may contact the live GitHub API. Coverage thresholds on `src/lib` are
enforced in CI.

## Reporting security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).

## Code of conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
