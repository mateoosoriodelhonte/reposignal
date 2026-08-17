/**
 * Date helpers shared across normalization and scoring.
 *
 * All of them are total: an unparseable or absent input yields `null` rather
 * than `NaN` or `0`. A `NaN` age silently compared against a threshold is
 * exactly how "we don't know" becomes "it's bad".
 */

const MS_PER_DAY = 86_400_000;

/** Parses an ISO timestamp, returning `null` for absent or invalid input. */
export function parseDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Whole days between two instants, rounded down and never negative.
 *
 * A timestamp slightly in the future — clock skew, or a scheduled release —
 * yields 0 rather than a negative age that would compare strangely against
 * every threshold.
 */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY));
}

/** Age in days of an ISO timestamp, or `null` if it is absent or invalid. */
export function ageInDays(value: string | null | undefined, now: Date): number | null {
  const date = parseDate(value);
  return date === null ? null : daysBetween(date, now);
}

/** Median of a numeric sample, or `null` when empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }

  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (lower === undefined || upper === undefined) return null;
  return (lower + upper) / 2;
}

/** Proportion of a sample at or above a threshold, or `null` when empty. */
export function proportionAtLeast(values: number[], threshold: number): number | null {
  if (values.length === 0) return null;
  return values.filter((value) => value >= threshold).length / values.length;
}
