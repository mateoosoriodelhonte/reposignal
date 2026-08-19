import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DistributionChart } from '@/components/distribution-chart';
import { bucketAges } from '@/lib/charts/histogram';

const AGES = [1, 3, 5, 20, 45, 100, 200, 400];

describe('DistributionChart', () => {
  it('renders the chart with an accessible label', () => {
    render(
      <DistributionChart
        buckets={bucketAges(AGES)}
        title="Open issue age"
        noun="open issues"
      />,
    );

    expect(screen.getByText('Open issue age')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /8 open issues by age/i }),
    ).toBeInTheDocument();
  });

  it('exposes the same numbers as a table for assistive technology', () => {
    // Built from the same buckets as the bars, so the description cannot
    // drift from the picture.
    render(
      <DistributionChart
        buckets={bucketAges(AGES)}
        title="Open issue age"
        noun="open issues"
      />,
    );

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: '0–7 days' })).toBeInTheDocument();
  });

  it('draws a gridline at each quarter of the maximum', () => {
    // A scale reference, so the reader can tell whether the longest bar is
    // 12 or 1,200 without reading the value column.
    const { container } = render(
      <DistributionChart
        buckets={bucketAges(AGES)}
        title="Open issue age"
        noun="open issues"
      />,
    );

    const lines = [...container.querySelectorAll('line')];
    expect(lines).toHaveLength(4);

    // 128 label + 340 plot: quarters land at 213, 298, 383, 468.
    expect(lines.map((line) => line.getAttribute('x1'))).toEqual([
      '213',
      '298',
      '383',
      '468',
    ]);

    // Vertical, and every line spans the full plot rather than one row.
    for (const line of lines) {
      expect(line.getAttribute('x1')).toBe(line.getAttribute('x2'));
      expect(line.getAttribute('y1')).toBe('0');
      expect(line.getAttribute('y2')).toBe('204');
    }
  });

  it('labels the gridlines with the maximum count only', () => {
    // Labelling every gridline would mean inventing round numbers, and at a
    // small maximum the quarter marks are fractional counts.
    const { container } = render(
      <DistributionChart
        buckets={bucketAges(AGES)}
        title="Open issue age"
        noun="open issues"
      />,
    );

    const max = Math.max(...bucketAges(AGES).map((bucket) => bucket.count));
    const tick = container.querySelector('g[aria-hidden="true"] text');

    expect(tick).not.toBeNull();
    expect(tick).toHaveTextContent(String(max));
    expect(tick?.getAttribute('text-anchor')).toBe('end');
  });

  it('keeps the scale reference out of the accessibility tree', () => {
    // The screen-reader table already carries exact values; gridlines would
    // only be noise.
    const { container } = render(
      <DistributionChart
        buckets={bucketAges(AGES)}
        title="Open issue age"
        noun="open issues"
      />,
    );

    const grid = container.querySelector('g[aria-hidden="true"]');
    expect(grid).not.toBeNull();
    expect(grid?.querySelectorAll('line')).toHaveLength(4);
  });

  it('grows the viewBox for the axis without widening the chart', () => {
    // The E2E suite asserts nothing overflows at 375px, so the scale
    // reference must not cost horizontal room.
    const { container } = render(
      <DistributionChart
        buckets={bucketAges(AGES)}
        title="Open issue age"
        noun="open issues"
      />,
    );

    const svg = container.querySelector('svg');
    // 6 buckets x 34 = 204 of plot, plus 16 of axis.
    expect(svg?.getAttribute('viewBox')).toBe('0 0 520 220');
    expect(svg?.getAttribute('width')).toBe('520');
    expect(svg?.classList.contains('max-w-full')).toBe(true);
  });

  it('renders nothing when there is too little data to chart', () => {
    // An empty frame would imply "we looked and found nothing to say".
    const { container } = render(
      <DistributionChart
        buckets={bucketAges([1, 2])}
        title="Open issue age"
        noun="open issues"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an empty distribution', () => {
    const { container } = render(
      <DistributionChart
        buckets={bucketAges([])}
        title="Open issue age"
        noun="open issues"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an optional description', () => {
    render(
      <DistributionChart
        buckets={bucketAges(AGES)}
        title="Open issue age"
        noun="open issues"
        description="How long issues have been open."
      />,
    );
    expect(screen.getByText('How long issues have been open.')).toBeInTheDocument();
  });
});
