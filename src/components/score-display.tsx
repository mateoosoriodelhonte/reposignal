import type { Confidence } from '@/types/analysis';

/**
 * Score presentation.
 *
 * Two rules hold everywhere in this file:
 *
 * 1. **A null score is never rendered as a number.** It renders as
 *    "Insufficient data" with the reason available, because showing `0` or a
 *    dash would read as "scored badly" rather than "not measured".
 * 2. **Colour never carries meaning alone.** Every score is accompanied by the
 *    number and a text band, so the information survives greyscale, colour
 *    blindness, and a screen reader.
 */

export type ScoreBand = 'strong' | 'moderate' | 'weak' | 'unknown';

export function bandFor(score: number | null): ScoreBand {
  if (score === null) return 'unknown';
  if (score >= 80) return 'strong';
  if (score >= 55) return 'moderate';
  return 'weak';
}

/** The text label that accompanies every score. */
export function bandLabel(score: number | null): string {
  switch (bandFor(score)) {
    case 'strong':
      return 'Strong';
    case 'moderate':
      return 'Moderate';
    case 'weak':
      return 'Needs attention';
    case 'unknown':
      return 'Insufficient data';
  }
}

const BAND_TEXT: Record<ScoreBand, string> = {
  strong: 'text-score-strong',
  moderate: 'text-score-moderate',
  weak: 'text-score-weak',
  unknown: 'text-score-unknown',
};

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span className="border-border-subtle text-muted inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
      {CONFIDENCE_LABEL[confidence]}
    </span>
  );
}

/**
 * The headline overall score.
 *
 * The `/ 100` is rendered as a separate, quieter element so a screen reader
 * announces "86 out of 100" rather than "86100".
 */
export function OverallScore({
  score,
  confidence,
}: {
  score: number | null;
  confidence: Confidence;
}) {
  const band = bandFor(score);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted text-sm font-medium tracking-wide uppercase">
        Engineering health
      </p>

      {score === null ? (
        <p className={`text-3xl font-semibold ${BAND_TEXT.unknown}`}>Insufficient data</p>
      ) : (
        <p className="flex items-baseline gap-2">
          <span className={`text-6xl font-semibold tabular-nums ${BAND_TEXT[band]}`}>
            {score}
          </span>
          <span className="text-muted text-2xl" aria-hidden="true">
            / 100
          </span>
          <span className="sr-only">out of 100</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-sm font-medium ${BAND_TEXT[band]}`}>
          {bandLabel(score)}
        </span>
        <ConfidenceBadge confidence={confidence} />
      </div>
    </div>
  );
}

/**
 * A category score as a labelled bar.
 *
 * The bar is decorative — `aria-hidden` — because the number and band label
 * beside it already carry the value. A screen reader reading a progressbar
 * role here would just repeat what it already announced.
 */
export function CategoryScoreBar({
  score,
  label,
}: {
  score: number | null;
  label: string;
}) {
  const band = bandFor(score);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {score === null ? (
          <span className={`text-sm ${BAND_TEXT.unknown}`}>Insufficient data</span>
        ) : (
          <span className={`text-sm font-semibold tabular-nums ${BAND_TEXT[band]}`}>
            {score}
            <span className="sr-only"> out of 100</span>
          </span>
        )}
      </div>

      <div
        className="bg-surface border-border-subtle h-1.5 w-full overflow-hidden rounded-full border"
        aria-hidden="true"
      >
        {score !== null && (
          <div
            className={`h-full rounded-full ${
              band === 'strong'
                ? 'bg-score-strong'
                : band === 'moderate'
                  ? 'bg-score-moderate'
                  : 'bg-score-weak'
            }`}
            style={{ width: `${score}%` }}
          />
        )}
      </div>
    </div>
  );
}
