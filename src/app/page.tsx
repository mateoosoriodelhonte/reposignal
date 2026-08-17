import { RepositorySearch } from '@/components/repository-search';
import { CATEGORY_LABELS, CATEGORY_WEIGHTS } from '@/lib/scoring/weights';
import type { CategoryKey } from '@/types/analysis';

const MEASURED: Array<{ key: CategoryKey; description: string }> = [
  {
    key: 'activity',
    description: 'Commit cadence, last push, and how recently and regularly it releases.',
  },
  {
    key: 'pullRequests',
    description: 'How long pull requests stay open, and how quickly they merge.',
  },
  {
    key: 'issues',
    description:
      'Backlog age, stale issues, and whether issues close as fast as they arrive.',
  },
  {
    key: 'ci',
    description:
      'Whether automated checks exist on the default branch, and whether they pass.',
  },
  {
    key: 'documentation',
    description:
      'README, LICENSE, CONTRIBUTING, templates, and a documentation directory.',
  },
  {
    key: 'repository',
    description: 'Lockfiles, dependency automation, CODEOWNERS, tags, and metadata.',
  },
  {
    key: 'security',
    description: 'A security policy, dependency automation, and scanning declared in CI.',
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        Understand a GitHub repository in 30 seconds.
      </h1>
      <p className="text-muted mt-4 text-lg">
        RepoSignal analyzes engineering health using public repository evidence.
      </p>

      <div className="mt-8">
        <RepositorySearch />
      </div>

      <section className="mt-16" aria-labelledby="what-it-measures">
        <h2 id="what-it-measures" className="text-xl font-semibold">
          What RepoSignal measures
        </h2>
        <p className="text-muted mt-2 text-sm">
          Seven categories, each scored independently and each fully explainable. Weights
          are shown because they are a judgment call, not a fact.
        </p>

        <dl className="mt-6 flex flex-col gap-4">
          {MEASURED.map(({ key, description }) => (
            <div
              key={key}
              className="border-border-subtle flex flex-col gap-1 border-b pb-4"
            >
              <dt className="flex items-baseline justify-between gap-4">
                <span className="font-medium">{CATEGORY_LABELS[key]}</span>
                <span className="text-muted shrink-0 text-xs tabular-nums">
                  weight {CATEGORY_WEIGHTS[key]}
                </span>
              </dt>
              <dd className="text-muted text-sm">{description}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-12" aria-labelledby="how-it-works">
        <h2 id="how-it-works" className="text-xl font-semibold">
          How the scores work
        </h2>

        <div className="text-muted mt-4 flex flex-col gap-3 text-sm">
          <p>
            Every number can be traced back to the public GitHub data it came from. Each
            category shows the metrics examined, their raw values, the weights applied,
            the thresholds used, and links to the evidence.
          </p>
          <p>
            <span className="text-foreground font-medium">
              Missing data is not treated as bad news.
            </span>{' '}
            When something cannot be observed — GitHub has not computed commit statistics,
            or branch protection needs permissions RepoSignal does not have — it is
            reported as unknown and excluded from the score, with its weight redistributed
            across what could be measured. It is never counted as zero.
          </p>
          <p>
            RepoSignal reports what it can observe. It does not read your code, does not
            scan for vulnerabilities, and does not use a language model to produce or
            adjust any score.
          </p>
        </div>
      </section>
    </div>
  );
}
