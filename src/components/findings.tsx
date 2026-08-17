import type { Finding, Severity } from '@/types/analysis';

/**
 * Findings list.
 *
 * Severity is shown as a text badge rather than a coloured dot, so it reads
 * identically in greyscale and to a screen reader. Every finding shows what
 * was observed, why it matters, the raw metric behind it, and a link to the
 * evidence on GitHub where one exists — that combination is what makes a
 * finding auditable rather than an assertion.
 */

const SEVERITY_LABEL: Record<Severity, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

const SEVERITY_CLASS: Record<Severity, string> = {
  high: 'border-severity-high text-severity-high',
  medium: 'border-severity-medium text-severity-medium',
  low: 'border-severity-low text-severity-low',
  info: 'border-severity-info text-severity-info',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-2 py-0.5 text-xs font-medium ${SEVERITY_CLASS[severity]}`}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

function MetricList({ metric }: { metric: Finding['metric'] }) {
  const entries = Object.entries(metric);
  if (entries.length === 0) return null;

  return (
    <dl className="text-muted flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-1">
          <dt className="font-medium">{humanize(key)}:</dt>
          <dd className="tabular-nums">{value === null ? 'Unknown' : String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FindingCard({ finding }: { finding: Finding }) {
  return (
    <li className="border-border-subtle bg-surface-raised rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-medium">{finding.title}</h3>
        <SeverityBadge severity={finding.severity} />
      </div>

      <p className="text-muted mt-2 text-sm">{finding.explanation}</p>

      <div className="mt-3">
        <MetricList metric={finding.metric} />
      </div>

      <p className="mt-3 text-sm">
        <span className="font-medium">Recommendation: </span>
        <span className="text-muted">{finding.recommendation}</span>
      </p>

      <div className="text-muted mt-3 flex flex-wrap items-center gap-3 text-xs">
        <span>Confidence: {finding.confidence}</span>
        {finding.evidenceUrl !== undefined && (
          <a
            className="text-accent underline underline-offset-2"
            href={finding.evidenceUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            View evidence on GitHub
          </a>
        )}
      </div>
    </li>
  );
}

export function FindingsList({
  findings,
  emptyMessage = 'No findings were raised for this category.',
}: {
  findings: Finding[];
  emptyMessage?: string;
}) {
  if (findings.length === 0) {
    return <p className="text-muted text-sm">{emptyMessage}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {findings.map((finding) => (
        <FindingCard key={finding.id} finding={finding} />
      ))}
    </ul>
  );
}

/** `staleIssues` → `Stale issues`. */
function humanize(key: string): string {
  const spaced = key.replace(/([A-Z])/g, ' $1').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
