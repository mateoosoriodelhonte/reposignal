import type { CategoryScore, Metric } from '@/types/analysis';

import { FindingsList } from './findings';
import { CategoryScoreBar, ConfidenceBadge } from './score-display';

/**
 * A category scorecard with its full methodology.
 *
 * The disclosure is a native `<details>` element: it works without JavaScript,
 * is keyboard operable for free, and is announced correctly by screen readers.
 * This is the "How was this calculated?" affordance the whole product is built
 * around, so it should be the least fragile thing on the page.
 */

const UNKNOWN_REASON_TEXT: Record<string, string> = {
  not_retrieved: 'Could not be retrieved',
  insufficient_data: 'Insufficient data',
  not_applicable: 'Not applicable',
  requires_elevated_permissions: 'Unable to verify from public GitHub data',
};

function MetricValue({ metric }: { metric: Metric }) {
  if (metric.value === null) {
    const reason = metric.unknownReason
      ? UNKNOWN_REASON_TEXT[metric.unknownReason]
      : undefined;
    return <span className="text-score-unknown">{reason ?? 'Unknown'}</span>;
  }

  return (
    <span className="tabular-nums">
      {String(metric.value)}
      {metric.unit !== undefined && <span className="text-muted"> {metric.unit}</span>}
    </span>
  );
}

function MethodologyTable({ category }: { category: CategoryScore }) {
  const { components } = category.explanation;
  if (components.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <caption className="sr-only">
          Scoring components for {category.label}, with the weight, observation, and rule
          applied to each
        </caption>
        <thead>
          <tr className="border-border-subtle text-muted border-b text-xs uppercase">
            <th scope="col" className="py-2 pr-4 font-medium">
              Component
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Score
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Weight
            </th>
            <th scope="col" className="py-2 font-medium">
              Observed
            </th>
          </tr>
        </thead>
        <tbody>
          {components.map((component) => (
            <tr key={component.id} className="border-border-subtle border-b align-top">
              <th scope="row" className="py-2 pr-4 font-medium">
                {component.label}
                <span className="text-muted mt-0.5 block text-xs font-normal">
                  {component.rule}
                </span>
              </th>
              <td className="py-2 pr-4 tabular-nums">
                {component.score === null ? (
                  <span className="text-score-unknown">Excluded</span>
                ) : (
                  component.score
                )}
              </td>
              <td className="text-muted py-2 pr-4 tabular-nums">{component.weight}</td>
              <td className="text-muted py-2">{component.observed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CategoryCard({ category }: { category: CategoryScore }) {
  return (
    <section
      className="border-border-subtle bg-surface-raised rounded-lg border p-5"
      aria-labelledby={`category-${category.key}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={`category-${category.key}`} className="text-lg font-semibold">
          {category.label}
        </h2>
        <ConfidenceBadge confidence={category.confidence} />
      </div>

      <div className="mt-4">
        <CategoryScoreBar score={category.score} label="Score" />
      </div>

      <p className="text-muted mt-4 text-sm">{category.explanation.summary}</p>

      {category.findings.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-medium">Findings</h3>
          <FindingsList findings={category.findings} />
        </div>
      )}

      <details className="group mt-5">
        <summary className="text-accent cursor-pointer text-sm font-medium underline underline-offset-4">
          How was this calculated?
        </summary>

        <div className="mt-4 flex flex-col gap-5">
          <div>
            <h3 className="mb-2 text-sm font-medium">Formula</h3>
            <p className="text-muted font-mono text-xs break-words">
              {category.explanation.formula}
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">Components and weights</h3>
            <MethodologyTable category={category} />
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">Metrics examined</h3>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {category.metrics.map((metric) => (
                <div
                  key={metric.id}
                  className="border-border-subtle flex justify-between gap-4 border-b py-1"
                >
                  <dt className="text-muted">{metric.label}</dt>
                  <dd className="text-right">
                    <MetricValue metric={metric} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">Limitations</h3>
            <ul className="text-muted list-disc space-y-1 pl-5 text-sm">
              {category.explanation.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </section>
  );
}
