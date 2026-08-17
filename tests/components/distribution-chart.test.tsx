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
