/**
 * Bucketing for the distribution charts.
 *
 * Pure functions, kept out of the components so the buckets can be tested
 * directly and so the accessible text alternative is generated from the same
 * data the bars are drawn from — not written separately and left to drift.
 */

export interface Bucket {
  label: string;
  /** Inclusive lower bound in days. */
  from: number;
  /** Exclusive upper bound in days, or `null` for the open-ended final bucket. */
  to: number | null;
  count: number;
}

/**
 * Age buckets, in days.
 *
 * Chosen to answer the question the chart exists for: is this backlog recent
 * or has it been accumulating? A linear axis would put almost everything in
 * the first bucket for an active project and tell you nothing.
 */
const AGE_BOUNDS: Array<{ label: string; from: number; to: number | null }> = [
  { label: '0–7 days', from: 0, to: 7 },
  { label: '1–4 weeks', from: 7, to: 30 },
  { label: '1–3 months', from: 30, to: 90 },
  { label: '3–6 months', from: 90, to: 180 },
  { label: '6–12 months', from: 180, to: 365 },
  { label: 'Over a year', from: 365, to: null },
];

export function bucketAges(ages: number[]): Bucket[] {
  return AGE_BOUNDS.map((bound) => ({
    ...bound,
    count: ages.filter(
      (age) => age >= bound.from && (bound.to === null || age < bound.to),
    ).length,
  }));
}

/**
 * Groups weekly commit counts into months, newest last.
 *
 * 52 individual weekly bars are unreadable at the width available; 12 monthly
 * ones show the trend the chart is for.
 */
export function bucketWeeklyCommits(weekly: number[]): Bucket[] {
  const buckets: Bucket[] = [];
  const weeksPerBucket = 4;

  for (let start = 0; start < weekly.length; start += weeksPerBucket) {
    const slice = weekly.slice(start, start + weeksPerBucket);
    const weeksAgoEnd = weekly.length - start;
    const weeksAgoStart = Math.max(0, weeksAgoEnd - slice.length);

    buckets.push({
      label: `${weeksAgoStart}–${weeksAgoEnd} weeks ago`,
      from: weeksAgoStart,
      to: weeksAgoEnd,
      count: slice.reduce((sum, count) => sum + count, 0),
    });
  }

  return buckets.reverse();
}

/** Describes a distribution in words, for the chart's text alternative. */
export function describeDistribution(buckets: Bucket[], noun: string): string {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (total === 0) return `No ${noun} to show.`;

  const parts = buckets
    .filter((bucket) => bucket.count > 0)
    .map((bucket) => `${bucket.label}: ${bucket.count}`);

  return `${total} ${noun} by age. ${parts.join('. ')}.`;
}

/**
 * Whether a distribution is worth drawing.
 *
 * A chart of three data points communicates less than the number three does,
 * and an empty chart communicates nothing at all. Below the threshold the
 * component renders nothing rather than an empty frame.
 */
export const MINIMUM_POINTS_FOR_CHART = 5;

export function worthCharting(buckets: Bucket[]): boolean {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  return total >= MINIMUM_POINTS_FOR_CHART;
}
