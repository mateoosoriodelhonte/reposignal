import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { AnalysisError, PartialDataBanner } from '@/components/analysis-error';
import { DistributionChart } from '@/components/distribution-chart';
import { CategoryCard } from '@/components/category-card';
import { FindingsList } from '@/components/findings';
import { CategoryScoreBar, OverallScore } from '@/components/score-display';
import { getAnalysisService } from '@/lib/analysis/container';
import { bucketAges, bucketWeeklyCommits } from '@/lib/charts/histogram';
import {
  formatRepositoryReference,
  parseRepositoryReference,
  type RepositoryReference,
} from '@/lib/validation/repository-reference';
import type { AnalysisResult } from '@/types/analysis';
import type { RepositorySnapshot } from '@/types/snapshot';

/**
 * The analysis page.
 *
 * Server rendered end to end. The only client JavaScript on this route is the
 * search form in the header on the homepage — the report itself is static
 * markup, which is why the disclosures are `<details>` elements rather than
 * state-driven components.
 *
 * The page renders `AnalysisResult` and calculates nothing. Every number on
 * screen was produced by a tested scoring function.
 */

export async function generateMetadata(
  props: PageProps<'/r/[owner]/[repository]'>,
): Promise<Metadata> {
  const { owner, repository } = await props.params;
  const parsed = parseRepositoryReference(`${owner}/${repository}`);

  if (!parsed.ok) return { title: 'Repository not found' };

  const fullName = `${parsed.value.owner}/${parsed.value.name}`;
  return {
    title: `${fullName} — engineering health`,
    description: `RepoSignal's evidence-backed engineering health analysis of ${fullName}.`,
  };
}

/**
 * Route params are validated here, above the Suspense boundary, rather than
 * inside it.
 *
 * `notFound()` can only set a 404 status while the response headers are still
 * open. Called from inside a streaming boundary the shell has already been
 * sent with a 200, so a malformed URL would render the not-found page under a
 * success status — wrong for crawlers, monitoring, and anything reading the
 * status rather than the body.
 *
 * The cost is that the shell waits on `params`, which is negligible: they are
 * already resolved by the time the route runs.
 */
export default async function AnalysisPage(props: PageProps<'/r/[owner]/[repository]'>) {
  const { owner, repository } = await props.params;

  // Route segments are user input like any other, so they go through the same
  // parser as the search form before anything is requested.
  const parsed = parseRepositoryReference(`${owner}/${repository}`);
  if (!parsed.ok) notFound();

  return (
    <Suspense fallback={<AnalysisSkeleton />}>
      <AnalysisContent reference={parsed.value} />
    </Suspense>
  );
}

async function AnalysisContent({ reference }: { reference: RepositoryReference }) {
  const fullName = formatRepositoryReference(reference);
  const service = await getAnalysisService();

  let outcome;
  try {
    outcome = await service.analyze(reference);
  } catch (error) {
    return <AnalysisError error={error} repository={fullName} />;
  }

  return (
    <AnalysisReport
      result={outcome.result}
      snapshot={outcome.snapshot}
      cached={outcome.cached}
      ageSeconds={outcome.ageSeconds}
    />
  );
}

/**
 * The distributions behind the scores.
 *
 * Each chart is omitted when there is too little data to be worth drawing,
 * rather than rendered as an empty frame — see `worthCharting`.
 */
function Distributions({ snapshot }: { snapshot: RepositorySnapshot }) {
  const issueAges =
    snapshot.issues === null ? [] : bucketAges(snapshot.issues.openAgeDays);
  const prAges =
    snapshot.pullRequests === null ? [] : bucketAges(snapshot.pullRequests.openAgeDays);
  const commits =
    snapshot.activity.weeklyCommits === null
      ? []
      : bucketWeeklyCommits(snapshot.activity.weeklyCommits);

  const charts = [
    issueAges.length > 0 && (
      <DistributionChart
        key="issues"
        buckets={issueAges}
        title="Open issue age"
        noun="open issues examined"
        description="How long the issues in the sample have been open."
      />
    ),
    prAges.length > 0 && (
      <DistributionChart
        key="prs"
        buckets={prAges}
        title="Open pull request age"
        noun="open pull requests examined"
        description="How long the pull requests in the sample have been open."
      />
    ),
    commits.length > 0 && (
      <DistributionChart
        key="commits"
        buckets={commits}
        title="Commit activity"
        noun="commits"
        description="Commits per four-week period over the trailing year."
      />
    ),
  ].filter(Boolean);

  if (charts.length === 0) return null;

  return (
    <section aria-labelledby="distributions-heading" className="min-w-0">
      <h2 id="distributions-heading" className="text-xl font-semibold">
        Distributions
      </h2>
      <p className="text-muted mt-1 mb-4 text-sm">
        The observations behind the scores above. Charts are omitted where there was too
        little data to draw one meaningfully.
      </p>

      <div className="border-border-subtle bg-surface-raised flex flex-col gap-8 rounded-lg border p-5">
        {charts}
      </div>
    </section>
  );
}

function AnalysisReport({
  result,
  snapshot,
  cached,
  ageSeconds,
}: {
  result: AnalysisResult;
  snapshot: RepositorySnapshot;
  cached: boolean;
  ageSeconds: number;
}) {
  const { repository, overall, categories, findings, limitations } = result;
  const priorityFindings = findings.filter(
    (finding) => finding.severity === 'high' || finding.severity === 'medium',
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-12">
      <header className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {repository.fullName}
            </h1>
            {repository.description !== null && (
              <p className="text-muted mt-1 max-w-2xl">{repository.description}</p>
            )}
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
              <a
                className="text-accent underline underline-offset-4"
                href={repository.htmlUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                View on GitHub
              </a>
              {repository.isArchived && <span className="text-muted">Archived</span>}
              {repository.isFork && <span className="text-muted">Fork</span>}
            </p>
          </div>

          <OverallScore score={overall.score} confidence={overall.confidence} />
        </div>

        <p className="text-muted text-sm">
          {cached ? <>Analyzed {formatAge(ageSeconds)}.</> : <>Analyzed just now.</>}{' '}
          Scoring algorithm version {result.scoringVersion}.
        </p>
      </header>

      <PartialDataBanner limitations={limitations} />

      <section
        aria-labelledby="categories-heading"
        className="flex min-w-0 flex-col gap-4"
      >
        <h2 id="categories-heading" className="text-xl font-semibold">
          Category scores
        </h2>

        <div className="border-border-subtle bg-surface-raised grid gap-x-8 gap-y-4 rounded-lg border p-5 sm:grid-cols-2">
          {categories.map((category) => (
            <CategoryScoreBar
              key={category.key}
              score={category.score}
              label={category.label}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="overall-method-heading" className="min-w-0">
        <h2 id="overall-method-heading" className="text-xl font-semibold">
          How the overall score was calculated
        </h2>

        <div className="border-border-subtle bg-surface-raised mt-4 rounded-lg border p-5">
          {overall.score === null ? (
            <p className="text-muted text-sm">{overall.formula}</p>
          ) : (
            <>
              <p className="text-muted font-mono text-xs break-words">
                {overall.formula}
              </p>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
                  <caption className="sr-only">
                    Each category&apos;s score and the weight it was given
                  </caption>
                  <thead>
                    <tr className="border-border-subtle text-muted border-b text-xs uppercase">
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Category
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Score
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Declared weight
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        Effective weight
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {overall.contributions.map((contribution) => {
                      const category = categories.find((c) => c.key === contribution.key);
                      return (
                        <tr
                          key={contribution.key}
                          className="border-border-subtle border-b"
                        >
                          <th scope="row" className="py-2 pr-4 font-medium">
                            {category?.label ?? contribution.key}
                          </th>
                          <td className="py-2 pr-4 tabular-nums">{contribution.score}</td>
                          <td className="text-muted py-2 pr-4 tabular-nums">
                            {contribution.declaredWeight}
                          </td>
                          <td className="text-muted py-2 tabular-nums">
                            {contribution.effectiveWeight}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {overall.excluded.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-medium">
                Excluded from the score, with weight redistributed
              </h3>
              <ul className="text-muted mt-2 list-disc space-y-1 pl-5 text-sm">
                {overall.excluded.map((entry) => {
                  const category = categories.find((c) => c.key === entry.key);
                  return (
                    <li key={entry.key}>
                      <span className="text-foreground font-medium">
                        {category?.label ?? entry.key}:
                      </span>{' '}
                      {entry.reason}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </section>

      <Distributions snapshot={snapshot} />

      <section aria-labelledby="findings-heading" className="min-w-0">
        <h2 id="findings-heading" className="text-xl font-semibold">
          Highest-priority findings
        </h2>
        <p className="text-muted mt-1 mb-4 text-sm">
          Observations RepoSignal could make from public data. Each states what was
          observed, not why — intent is not something this data reveals.
        </p>
        <FindingsList
          findings={priorityFindings}
          emptyMessage="No high or medium severity findings were raised."
        />
      </section>

      <section aria-labelledby="detail-heading" className="flex min-w-0 flex-col gap-4">
        <h2 id="detail-heading" className="text-xl font-semibold">
          Category detail
        </h2>
        {categories.map((category) => (
          <CategoryCard key={category.key} category={category} />
        ))}
      </section>
    </div>
  );
}

function AnalysisSkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-12" aria-busy="true">
      <p role="status" className="text-muted">
        Analyzing repository…
      </p>
      <p className="text-muted mt-2 text-sm">
        RepoSignal is reading public GitHub data. This usually takes a few seconds.
      </p>
    </div>
  );
}

function formatAge(seconds: number): string {
  if (seconds < 60) return 'less than a minute ago';
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
}
