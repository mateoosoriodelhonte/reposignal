# Scoring methodology

**Scoring algorithm version: `1.0.0`**

This document is the complete specification of how RepoSignal produces a
number. Every weight, threshold, and formula is here, along with why it is what
it is.

If you disagree with a score, this page should let you find the exact rule
responsible and argue with it specifically. That is the point — a score you
cannot interrogate is not worth showing.

---

## Contents

- [The rule everything else follows](#the-rule-everything-else-follows)
- [How the overall score is calculated](#how-the-overall-score-is-calculated)
- [Category weights](#category-weights)
- [How a category score is calculated](#how-a-category-score-is-calculated)
- [Confidence](#confidence)
- [Repository Activity](#repository-activity)
- [Pull Request Health](#pull-request-health)
- [Issue Health](#issue-health)
- [CI Health](#ci-health)
- [Documentation](#documentation)
- [Repository Hygiene](#repository-hygiene)
- [Security Hygiene](#security-hygiene)
- [On the thresholds](#on-the-thresholds)
- [Version history](#version-history)

---

## The rule everything else follows

> **Missing data is not evidence of poor health.**

Concretely:

- A metric that could not be observed is `null`, carrying a reason.
- A scoring component that could not be evaluated is **excluded**, and its
  weight is redistributed across the components that could be.
- A category with too little evidence scores `null`, not `0`.
- A `null` category is **excluded from the overall score**, and its weight is
  redistributed.

The consequence, which is asserted directly by a test: **adding a `null`
category can never lower the overall score.**

If missing data were scored as zero instead, a repository with issues disabled
would be punished for a setting, and one whose commit statistics GitHub has not
finished computing would be punished for GitHub's queue.

---

## How the overall score is calculated

Categories that produced a score are averaged, weighted by their declared
weight renormalized over the scorable set:

```
overall = Σ(categoryScore × declaredWeight) / Σ(declaredWeight)
          — over scored categories only
```

**Below three scored categories, the overall score is `null`.** Averaging two
categories and presenting the result as engineering health implies far more
coverage than that evidence supports.

### Worked example

A repository with issues disabled and unreadable CI:

| Category            | Score  | Declared weight | Effective weight |
| ------------------- | ------ | --------------- | ---------------- |
| Repository Activity | 80     | 15              | 21.4%            |
| Pull Request Health | 90     | 15              | 21.4%            |
| Issue Health        | `null` | 15              | — excluded       |
| CI Health           | `null` | 15              | — excluded       |
| Documentation       | 100    | 15              | 21.4%            |
| Repository Hygiene  | 70     | 15              | 21.4%            |
| Security Hygiene    | 60     | 10              | 14.3%            |

Scorable weight is 70 of 100, so each surviving weight is divided by 70:

```
(80×15 + 90×15 + 100×15 + 70×15 + 60×10) / 70
= (1200 + 1350 + 1500 + 1050 + 600) / 70
= 5700 / 70
= 81
```

The two excluded categories are listed in the UI with the reason each was
excluded. Had they been scored `0`, the result would have been 57 — a number
describing GitHub's API permissions rather than the repository.

---

## Category weights

Declared in [`src/lib/scoring/weights.ts`](../src/lib/scoring/weights.ts).
They sum to 100, asserted by a test.

| Category            | Weight |
| ------------------- | ------ |
| Repository Activity | 15     |
| Pull Request Health | 15     |
| Issue Health        | 15     |
| CI Health           | 15     |
| Documentation       | 15     |
| Repository Hygiene  | 15     |
| Security Hygiene    | 10     |

**Why six are equal.** RepoSignal has no evidence that any one dimension of
engineering health predicts another better. Asserting a hierarchy — that CI
matters twice as much as documentation, say — would be fabricated precision.
Equal weights are the honest default in the absence of data.

**Why security is lower.** Security Hygiene observes the fewest independent
signals (four), so a single missing file moves it further than it should move
a total. The lower weight compensates for its higher variance, not for security
mattering less.

These are the most arguable numbers in the project, which is exactly why they
are displayed on every analysis rather than buried here.

---

## How a category score is calculated

Each category is a weighted average of components. A component scores 0–100 or
`null`:

```
category = Σ(componentScore × weight) / Σ(weight)
           — over evaluated components only
```

A category returns `null` when fewer than **50%** of its declared component
weight could be evaluated. Below that, the surviving components are too thin a
basis to speak for the whole category.

---

## Confidence

Confidence is reported separately from the score, because "we are fairly sure
this is 60" and "this might be 60" are different claims.

Two independent inputs lower it:

1. **Coverage** — how much of the declared weight was scorable.
2. **Truncation** — whether the underlying sample was cut short by the request
   budget.

| Condition                            | Confidence                   |
| ------------------------------------ | ---------------------------- |
| ≥90% of weight scored, no truncation | High                         |
| ≥60% of weight scored                | High, or Medium if truncated |
| ≥40% of weight scored                | Medium                       |
| Below 40%                            | Low                          |

Overall confidence is the lower of coverage-derived confidence and the least
confident contributing category. A total built from confident categories that
only cover half the picture is not a confident total.

---

## Repository Activity

Whether the project is actively developed.

| Component               | Weight | Rule                                                   |
| ----------------------- | ------ | ------------------------------------------------------ |
| Time since last push    | 35     | Banded, see below                                      |
| Weeks with commits      | 25     | Proportion of the trailing year's weeks with ≥1 commit |
| Time since last release | 25     | Banded, see below                                      |
| Release cadence         | 15     | Coefficient of variation of inter-release intervals    |

**Days since last push**

| Days | Score | Band                   |
| ---- | ----- | ---------------------- |
| ≤30  | 100   | Pushed within a month  |
| ≤90  | 85    | Pushed within 3 months |
| ≤180 | 65    | Pushed within 6 months |
| ≤365 | 40    | Pushed within a year   |
| >365 | 15    | No push in over a year |

**Days since last release**

| Days | Score |
| ---- | ----- |
| ≤90  | 100   |
| ≤180 | 85    |
| ≤365 | 65    |
| ≤730 | 40    |
| >730 | 20    |

### Archived repositories

**An archived repository is not scored as neglected.** Archiving is a
deliberate act meaning "this is finished", and scoring it as abandonment would
punish a maintainer for closing a project down responsibly.

Recency components are excluded entirely. The category is scored on what the
project left behind — its release history — and an `info` finding reports the
archival.

### Release cadence

Uses the **coefficient of variation** (standard deviation ÷ mean) of intervals
between releases, so it measures _consistency_ independent of _frequency_. A
project releasing predictably every six months scores the same as one releasing
predictably every week.

`null` below **three releases**: two releases give exactly one interval, and one
interval has no variation to measure.

### Limitations

- Measures visible timestamps, not effort. A single automated commit and a
  substantial feature look identical.
- Unavailable commit statistics score `null`. GitHub computes them
  asynchronously and answers `202` until ready; treating that as zero commits
  would make a busy repository look dead.
- Inactivity is not abandonment. A small, finished library may correctly go
  years without a commit.

---

## Pull Request Health

How pull requests move.

| Component                          | Weight | Rule                                             |
| ---------------------------------- | ------ | ------------------------------------------------ |
| Long-lived open PRs                | 35     | Proportion of open PRs older than 90 days        |
| Median time to merge (approximate) | 35     | Banded, see below                                |
| Merged share of decided PRs        | 30     | merged ÷ (merged + closed-unmerged) over 90 days |

**Long-lived threshold: 90 days.** Long enough that a PR has survived a normal
review cycle and a release; short enough to still mean something.

| Proportion long-lived | Score |
| --------------------- | ----- |
| ≤10%                  | 100   |
| ≤25%                  | 85    |
| ≤50%                  | 60    |
| ≤75%                  | 35    |
| >75%                  | 15    |

**Median days to merge**

| Days | Score |
| ---- | ----- |
| ≤2   | 100   |
| ≤7   | 90    |
| ≤30  | 70    |
| ≤90  | 45    |
| >90  | 25    |

**Median, not mean.** One pull request left open for four years and then merged
would drag a mean from 2 days to 251. The median is the honest summary of a
distribution with that shape, and there is a test asserting exactly this case.

### Limitations

- Based on a sample of up to 200 recent pull requests, so every derived figure
  is approximate and labelled as such in the UI.
- `null` when the repository has never had a pull request — distinct from a
  repository that merges nothing.
- Review latency and approval counts are not measured; reading them costs more
  requests than the analysis budget allows.
- A pull request closed without merging may have been correctly declined.
  RepoSignal cannot observe that distinction and does not guess at it.

---

## Issue Health

Whether the backlog is being tended.

| Component                    | Weight | Rule                                        |
| ---------------------------- | ------ | ------------------------------------------- |
| Stale issue proportion       | 40     | Open issues with no activity for 180+ days  |
| Median open issue age        | 30     | Banded, see below                           |
| Close rate against open rate | 30     | closed ÷ opened over 90 days, capped at 1.0 |

**Stale threshold: 180 days.** Long enough to survive a normal release cycle
and a quiet summer. Shorter thresholds flag healthy projects that batch their
triage; much longer ones stop distinguishing anything.

| Proportion stale | Score |
| ---------------- | ----- |
| ≤10%             | 100   |
| ≤25%             | 85    |
| ≤50%             | 60    |
| ≤75%             | 35    |
| >75%             | 15    |

**Median open issue age**

| Days | Score |
| ---- | ----- |
| ≤30  | 100   |
| ≤90  | 85    |
| ≤180 | 65    |
| ≤365 | 45    |
| >365 | 25    |

### Pull requests are excluded

GitHub's `/issues` endpoints return pull requests alongside issues. Every
payload carrying a `pull_request` key is discarded during normalization.
Missing this inflates every issue metric on any repository that takes
contributions — which is most of them. There is a dedicated regression test at
both the unit and integration level.

### Limitations

- `null` when issues are disabled. That is "not applicable", not "an empty
  backlog".
- Based on a sample of up to 300 issues.
- A large stale backlog on a stable, finished project means something quite
  different than on an actively marketed one. RepoSignal cannot tell those
  apart, and says so.
- Findings state observations, never intent. "37 issues have had no activity
  for more than 180 days" is a fact; "the maintainers are ignoring the backlog"
  is a claim about intent that this data does not support. A test asserts no
  issue finding contains language of that kind.

---

## CI Health

Whether automated checks exist and pass.

| Component               | Weight | Rule                                             |
| ----------------------- | ------ | ------------------------------------------------ |
| CI configured           | 30     | Workflows or commit status checks present        |
| Recent run success rate | 45     | Successful ÷ decisive runs on the default branch |
| Latest commit status    | 25     | success 100, pending 70, failure 0, none `null`  |

### Three states kept deliberately apart

| Observation                | Result | Why                                        |
| -------------------------- | ------ | ------------------------------------------ |
| CI data unreadable         | `null` | Absence of data is not evidence of failure |
| No CI configured, readably | `0`    | A real observation about configuration     |
| CI configured and failing  | scored | A real observation about outcomes          |

This is the category where an unavailability-means-failure bug would do the
most damage, so the first row is asserted directly by test.

### Cancelled and skipped runs are excluded

They are not counted as failures. A cancelled run is usually a superseded one,
and counting it would penalize exactly the projects that cancel outdated runs
to save CI minutes.

**Consecutive-failure threshold: 3.** Three consecutive failures on the default
branch is past the point where a single bad merge explains it, and produces a
`high` severity finding.

### Limitations

- Only GitHub Actions and commit status checks are visible. A project using
  external CI that does not report status back to GitHub appears to have none.
- Run outcomes are read from the default branch only.

---

## Documentation

Whether the files a newcomer needs are present.

| Component         | Weight | Rule                                             |
| ----------------- | ------ | ------------------------------------------------ |
| README            | 30     | ≥300 bytes 100, present but smaller 50, absent 0 |
| LICENSE           | 20     | Present 100, absent 0                            |
| CONTRIBUTING      | 15     | ≥200 bytes 100, present but smaller 50, absent 0 |
| Code of conduct   | 10     | Present 100, absent 0                            |
| Issue templates   | 10     | Present 100, absent 0                            |
| Documentation dir | 10     | Present 100, absent 0                            |
| PR template       | 5      | Present 100, absent 0                            |

**README stub threshold: 300 bytes.** Roughly a title, a one-line description,
and an install command — enough to identify a project, not enough to explain
it. This measures length only; it says nothing about quality.

### Limitations

- Presence and size only. RepoSignal does not read documentation content, so it
  cannot tell a thorough README from a long but unhelpful one.
- Only the repository root and `.github/` are examined.
- Files are matched by conventional name. An unconventional filename reads as
  absent.

---

## Repository Hygiene

Practices that make a project reproducible and maintainable.

| Component              | Weight | Rule                                                |
| ---------------------- | ------ | --------------------------------------------------- |
| Dependency lockfile    | 20     | Any recognized lockfile 100, none 0                 |
| `.gitignore`           | 15     | Present 100, absent 0                               |
| Dependency automation  | 15     | Dependabot or Renovate config 100, absent 0         |
| Release tags           | 15     | ≥1 tag 100, none 0, unreadable `null`               |
| Description and topics | 15     | Description 50 + (≥3 topics) 50                     |
| CODEOWNERS             | 10     | Present 100, absent 0                               |
| Branch protection      | 10     | Protected 100, unprotected 0, **unreadable `null`** |

### Branch protection

Reading branch protection requires administrative access, which RepoSignal does
not have for repositories it does not own. When GitHub refuses, the component
scores `null`, its weight is redistributed, and the UI says:

> Unable to verify from public GitHub data.

Reporting "unknown" as "not protected" would penalize a repository for a
permission RepoSignal lacks. A test asserts that an unverifiable result scores
identically to a verified-protected one, and strictly higher than a
verified-unprotected one.

Lockfile detection covers npm, yarn, pnpm, bun, pip, poetry, uv, Cargo, Go,
Bundler, Composer, NuGet, Mix, Pub, and Gradle.

---

## Security Hygiene

**This category measures observable practices, not security posture.**

A repository scoring 100 has adopted four visible practices. It has _not_ been
assessed as secure, and nothing in the module says otherwise — there is a test
that collects every user-facing string in it and asserts none of them claims a
repository is secure.

| Component               | Weight | Rule                                        |
| ----------------------- | ------ | ------------------------------------------- |
| Security policy         | 30     | `SECURITY.md` present 100, absent 0         |
| Dependency automation   | 25     | Dependabot or Renovate config 100, absent 0 |
| Scanning declared in CI | 25     | A recognized scanning step 100, none 0      |
| Committed lockfile      | 20     | Any recognized lockfile 100, none 0         |

Scanning detection is **plain text matching** against a bounded sample of
workflow files, looking for names such as `github/codeql-action`,
`aquasecurity/trivy-action`, `snyk/actions`, `semgrep`, `gitleaks`,
`trufflehog`, `dependency-review-action`, and `npm audit`. Nothing is executed
or evaluated.

### What RepoSignal does not do

- No vulnerability scanning
- No dependency CVE lookup
- No secret detection
- No code analysis of any kind
- No claim that a repository is secure

GitHub features such as private vulnerability reporting and secret-scanning
alerts are not readable from public data and are not assessed.

---

## On the thresholds

The thresholds on this page are **defensible judgments, not empirical
findings.** They were chosen to be explainable and to distinguish meaningfully
between repositories at the extremes, not derived from a labelled dataset of
healthy and unhealthy projects — no such dataset exists, and inventing one
would be worse than admitting this.

Being transparent about that is the point. Every threshold is a constant with a
comment explaining its reasoning, every one is shown in the UI beside the score
it produced, and every one is tested at its boundary and one unit either side.

If a threshold is wrong, it should be arguable — and changing it is a
[documented process](../CONTRIBUTING.md), not a silent edit.

---

## Version history

Every stored analysis records the `scoringVersion` it was produced under, so a
historical result stays interpretable after the rules change. A cached analysis
produced under a different version is never served.

Any change to a weight, threshold, or formula requires a version bump and an
entry here.

### 1.0.0

Initial scoring algorithm. Seven categories, weights and thresholds as
documented above.
