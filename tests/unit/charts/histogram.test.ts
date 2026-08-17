import { describe, expect, it } from 'vitest';

import {
  MINIMUM_POINTS_FOR_CHART,
  bucketAges,
  bucketWeeklyCommits,
  describeDistribution,
  worthCharting,
} from '@/lib/charts/histogram';

describe('bucketAges', () => {
  it('returns every bucket, including empty ones', () => {
    // Empty buckets are kept so the chart has a consistent shape and a gap in
    // the distribution is visible as a gap.
    const buckets = bucketAges([1]);

    expect(buckets).toHaveLength(6);
    expect(buckets.filter((b) => b.count === 0)).toHaveLength(5);
  });

  it('places ages in the expected buckets', () => {
    const buckets = bucketAges([1, 3, 10, 45, 120, 200, 400, 900]);
    const counts = Object.fromEntries(buckets.map((b) => [b.label, b.count]));

    expect(counts['0–7 days']).toBe(2);
    expect(counts['1–4 weeks']).toBe(1);
    expect(counts['1–3 months']).toBe(1);
    expect(counts['3–6 months']).toBe(1);
    expect(counts['6–12 months']).toBe(1);
    expect(counts['Over a year']).toBe(2);
  });

  it.each([
    [7, '1–4 weeks'],
    [30, '1–3 months'],
    [90, '3–6 months'],
    [180, '6–12 months'],
    [365, 'Over a year'],
  ])('puts a boundary value of %i days in %s', (age, expected) => {
    // Bounds are inclusive-lower, exclusive-upper, so a value exactly on a
    // boundary belongs to the higher bucket.
    const buckets = bucketAges([age]);
    expect(buckets.find((b) => b.count === 1)?.label).toBe(expected);
  });

  it('handles an empty input without inventing a shape', () => {
    const buckets = bucketAges([]);
    expect(buckets).toHaveLength(6);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });
});

describe('bucketWeeklyCommits', () => {
  it('groups 52 weeks into 13 four-week periods', () => {
    const buckets = bucketWeeklyCommits(Array.from({ length: 52 }, () => 1));

    expect(buckets).toHaveLength(13);
    expect(buckets.every((b) => b.count === 4)).toBe(true);
  });

  it('puts the most recent period first', () => {
    const weekly = Array.from({ length: 52 }, (_, index) => (index >= 48 ? 10 : 0));
    const buckets = bucketWeeklyCommits(weekly);

    expect(buckets[0]?.label).toBe('0–4 weeks ago');
    expect(buckets[0]?.count).toBe(40);
  });

  it('handles a partial final period', () => {
    const buckets = bucketWeeklyCommits([1, 2, 3, 4, 5]);
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(15);
  });

  it('handles an empty input', () => {
    expect(bucketWeeklyCommits([])).toEqual([]);
  });
});

describe('describeDistribution', () => {
  it('states the total and each non-empty bucket', () => {
    const text = describeDistribution(bucketAges([1, 2, 45]), 'open issues');

    expect(text).toContain('3 open issues');
    expect(text).toContain('0–7 days: 2');
    expect(text).toContain('1–3 months: 1');
  });

  it('omits empty buckets from the description', () => {
    // The chart shows them; reading every zero aloud would be noise.
    expect(describeDistribution(bucketAges([1]), 'open issues')).not.toContain(
      'Over a year',
    );
  });

  it('says so plainly when there is nothing to describe', () => {
    expect(describeDistribution(bucketAges([]), 'open issues')).toBe(
      'No open issues to show.',
    );
  });
});

describe('worthCharting', () => {
  it(`is false below ${MINIMUM_POINTS_FOR_CHART} data points`, () => {
    // A chart of three points communicates less than the number three does.
    expect(worthCharting(bucketAges([1, 2, 3, 4]))).toBe(false);
  });

  it(`is true at exactly ${MINIMUM_POINTS_FOR_CHART}`, () => {
    expect(worthCharting(bucketAges([1, 2, 3, 4, 5]))).toBe(true);
  });

  it('is false for an empty distribution', () => {
    expect(worthCharting(bucketAges([]))).toBe(false);
  });
});
