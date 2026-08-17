import { describe, expect, it } from 'vitest';

import {
  ageInDays,
  daysBetween,
  median,
  parseDate,
  proportionAtLeast,
} from '@/lib/normalize/dates';

const NOW = new Date('2026-06-01T00:00:00Z');

describe('parseDate', () => {
  it('parses a valid ISO timestamp', () => {
    expect(parseDate('2026-05-01T00:00:00Z')?.toISOString()).toBe(
      '2026-05-01T00:00:00.000Z',
    );
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['a non-date string', 'not-a-date'],
    ['a nonsense date', '2026-13-45T99:99:99Z'],
  ])('returns null for %s rather than an invalid Date', (_label, input) => {
    expect(parseDate(input)).toBeNull();
  });
});

describe('daysBetween', () => {
  it('counts whole days', () => {
    expect(daysBetween(new Date('2026-05-01T00:00:00Z'), NOW)).toBe(31);
  });

  it('floors a partial day rather than rounding up', () => {
    expect(daysBetween(new Date('2026-05-31T12:00:00Z'), NOW)).toBe(0);
  });

  it('clamps a future timestamp to zero instead of going negative', () => {
    // Clock skew and scheduled releases both produce future timestamps. A
    // negative age would compare strangely against every threshold.
    expect(daysBetween(new Date('2026-07-01T00:00:00Z'), NOW)).toBe(0);
  });
});

describe('ageInDays', () => {
  it('measures age from an ISO timestamp', () => {
    expect(ageInDays('2026-05-02T00:00:00Z', NOW)).toBe(30);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an unparseable value', 'yesterday'],
  ])('returns null for %s rather than NaN or zero', (_label, input) => {
    // A NaN age silently compared against a threshold is exactly how
    // "we don't know" becomes "it's bad".
    expect(ageInDays(input, NOW)).toBeNull();
  });
});

describe('median', () => {
  it('returns null for an empty sample', () => {
    expect(median([])).toBeNull();
  });

  it('returns the middle value of an odd-length sample', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('averages the two middle values of an even-length sample', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('resists a single extreme outlier, unlike the mean', () => {
    // This is why merge velocity uses the median: one four-year-old PR should
    // not make a fast-merging project look slow.
    const values = [1, 2, 2, 3, 1500];
    expect(median(values)).toBe(2);
  });

  it('does not mutate its input', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });

  it('handles a single value', () => {
    expect(median([7])).toBe(7);
  });
});

describe('proportionAtLeast', () => {
  it('returns null for an empty sample rather than zero', () => {
    expect(proportionAtLeast([], 10)).toBeNull();
  });

  it('counts values at or above the threshold', () => {
    expect(proportionAtLeast([1, 5, 10, 20], 10)).toBe(0.5);
  });

  it('includes the boundary value itself', () => {
    expect(proportionAtLeast([10], 10)).toBe(1);
  });

  it('returns zero when nothing meets the threshold', () => {
    expect(proportionAtLeast([1, 2, 3], 100)).toBe(0);
  });
});
