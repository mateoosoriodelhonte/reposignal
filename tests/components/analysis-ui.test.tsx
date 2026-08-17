import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnalysisError, PartialDataBanner } from '@/components/analysis-error';
import { CategoryCard } from '@/components/category-card';
import { FindingsList } from '@/components/findings';
import { CategoryScoreBar, OverallScore, bandLabel } from '@/components/score-display';
import { GitHubError, RateLimitError } from '@/lib/github/errors';
import { analyzeSnapshot } from '@/lib/scoring';
import type { CategoryScore, Finding } from '@/types/analysis';

import { NOW, buildHealthySnapshot, buildSnapshot } from '../support/snapshot-builder';

const OPTIONS = { now: NOW, analysisId: 'test' };

function categoryFor(key: string, snapshot = buildHealthySnapshot()): CategoryScore {
  const result = analyzeSnapshot(snapshot, OPTIONS);
  const category = result.categories.find((c) => c.key === key);
  if (category === undefined) throw new Error(`No category ${key}`);
  return category;
}

describe('OverallScore', () => {
  it('shows the score with an accessible "out of 100"', () => {
    render(<OverallScore score={86} confidence="high" />);

    expect(screen.getByText('86')).toBeInTheDocument();
    expect(screen.getByText('out of 100')).toBeInTheDocument();
  });

  it('renders "Insufficient data" instead of a number when the score is null', () => {
    // The rule the whole product depends on: null must never look like zero.
    render(<OverallScore score={null} confidence="low" />);

    // Appears twice by design: as the value, and as the band label beneath it.
    expect(screen.getAllByText('Insufficient data')).toHaveLength(2);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('out of 100')).not.toBeInTheDocument();
  });

  it('pairs the score with a text band so colour is never the only signal', () => {
    render(<OverallScore score={40} confidence="high" />);
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  it('always states its confidence', () => {
    render(<OverallScore score={70} confidence="medium" />);
    expect(screen.getByText('Medium confidence')).toBeInTheDocument();
  });
});

describe('bandLabel', () => {
  it.each([
    [100, 'Strong'],
    [80, 'Strong'],
    [79, 'Moderate'],
    [55, 'Moderate'],
    [54, 'Needs attention'],
    [0, 'Needs attention'],
    [null, 'Insufficient data'],
  ])('labels %s as %s', (score, expected) => {
    expect(bandLabel(score)).toBe(expected);
  });
});

describe('CategoryScoreBar', () => {
  it('shows the label and score', () => {
    render(<CategoryScoreBar score={72} label="Issue Health" />);

    expect(screen.getByText('Issue Health')).toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument();
  });

  it('says "Insufficient data" for a null score', () => {
    render(<CategoryScoreBar score={null} label="CI Health" />);

    expect(screen.getByText('Insufficient data')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});

describe('FindingsList', () => {
  const finding: Finding = {
    id: 'issues.stale.backlog',
    category: 'issues',
    severity: 'high',
    title: 'Large proportion of stale issues',
    explanation: '37 of the 91 open issues have had no activity for 180 days.',
    metric: { staleIssues: 37, openIssues: 91, thresholdDays: 180 },
    recommendation: 'Review stale issues and classify them.',
    confidence: 'high',
    evidenceUrl: 'https://github.com/acme/widget/issues',
  };

  it('shows the title, severity, explanation, and recommendation', () => {
    render(<FindingsList findings={[finding]} />);

    expect(screen.getByText(finding.title)).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText(finding.explanation)).toBeInTheDocument();
    expect(screen.getByText(finding.recommendation)).toBeInTheDocument();
  });

  it('shows the raw metrics behind the finding', () => {
    render(<FindingsList findings={[finding]} />);

    expect(screen.getByText('Stale issues:')).toBeInTheDocument();
    expect(screen.getByText('37')).toBeInTheDocument();
  });

  it('links to the evidence, opening safely in a new tab', () => {
    render(<FindingsList findings={[finding]} />);

    const link = screen.getByRole('link', { name: /view evidence/i });
    expect(link).toHaveAttribute('href', finding.evidenceUrl);
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('omits the evidence link when there is no evidence to link to', () => {
    const { evidenceUrl: _omitted, ...withoutEvidence } = finding;
    render(<FindingsList findings={[withoutEvidence]} />);

    expect(
      screen.queryByRole('link', { name: /view evidence/i }),
    ).not.toBeInTheDocument();
  });

  it('renders an unknown metric value as "Unknown" rather than blank', () => {
    render(
      <FindingsList findings={[{ ...finding, metric: { contributorCount: null } }]} />,
    );
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('shows an empty message rather than an empty list', () => {
    render(<FindingsList findings={[]} emptyMessage="Nothing to report." />);
    expect(screen.getByText('Nothing to report.')).toBeInTheDocument();
  });
});

describe('CategoryCard', () => {
  it('renders the category with its score and summary', () => {
    const category = categoryFor('documentation');
    render(<CategoryCard category={category} />);

    expect(
      screen.getByRole('heading', { name: category.label, level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByText(category.explanation.summary)).toBeInTheDocument();
  });

  it('offers the methodology disclosure', () => {
    render(<CategoryCard category={categoryFor('documentation')} />);
    expect(screen.getByText('How was this calculated?')).toBeInTheDocument();
  });

  it('discloses the formula, weights, and limitations', () => {
    const category = categoryFor('documentation');
    render(<CategoryCard category={category} />);

    expect(screen.getByText(category.explanation.formula)).toBeInTheDocument();
    expect(
      screen.getByRole('table', { name: /scoring components/i }),
    ).toBeInTheDocument();

    for (const limitation of category.explanation.limitations) {
      expect(screen.getByText(limitation)).toBeInTheDocument();
    }
  });

  it('names every scoring component with its weight', () => {
    const category = categoryFor('documentation');
    const table = screen.queryByRole('table');
    render(<CategoryCard category={category} />);

    for (const component of category.explanation.components) {
      expect(screen.getByText(component.label)).toBeInTheDocument();
    }
    expect(table).toBeNull();
  });

  it('shows an excluded component as "Excluded", not as zero', () => {
    // Branch protection is unreadable on the default fixture.
    const category = categoryFor('repository');
    render(<CategoryCard category={category} />);

    const table = screen.getByRole('table');
    expect(within(table).getByText('Excluded')).toBeInTheDocument();
  });

  it('explains an unknown metric with its reason rather than showing a blank', () => {
    const category = categoryFor('repository');
    render(<CategoryCard category={category} />);

    // Stated in both the component's observation and the metric's value.
    expect(
      screen.getAllByText('Unable to verify from public GitHub data').length,
    ).toBeGreaterThan(0);
  });

  it('renders a null-scoring category without inventing a number', () => {
    const category = categoryFor('issues', buildSnapshot({ issues: null }));
    render(<CategoryCard category={category} />);

    expect(screen.getByText('Insufficient data')).toBeInTheDocument();
  });
});

describe('PartialDataBanner', () => {
  it('names what could not be retrieved', () => {
    render(<PartialDataBanner limitations={['Could not retrieve actions/runs.']} />);

    expect(screen.getByText('Some data could not be retrieved')).toBeInTheDocument();
    expect(screen.getByText('Could not retrieve actions/runs.')).toBeInTheDocument();
  });

  it('states that missing data was excluded, not counted against the repository', () => {
    render(<PartialDataBanner limitations={['Something failed.']} />);
    expect(screen.getByText(/excluded from the score/i)).toBeInTheDocument();
  });

  it('renders nothing when there were no limitations', () => {
    const { container } = render(<PartialDataBanner limitations={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AnalysisError', () => {
  it('explains a missing repository specifically', () => {
    render(
      <AnalysisError
        error={new GitHubError('not_found', 'nope')}
        repository="acme/missing"
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Repository not found' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/acme\/missing/)).toBeInTheDocument();
    expect(screen.getByText(/only reads public data/i)).toBeInTheDocument();
  });

  it('tells the user when a rate limit resets', () => {
    render(
      <AnalysisError
        error={
          new RateLimitError('limited', {
            resetAt: new Date('2026-06-01T13:30:00Z'),
          })
        }
        repository="acme/widget"
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'GitHub rate limit reached' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/resets around/i)).toBeInTheDocument();
  });

  it('distinguishes the secondary throttle from the primary limit', () => {
    render(
      <AnalysisError
        error={new RateLimitError('throttled', { isSecondary: true, resetAt: null })}
        repository="acme/widget"
      />,
    );
    expect(screen.getByText(/temporarily throttling/i)).toBeInTheDocument();
  });

  it.each([
    ['forbidden', 'Repository is not accessible'],
    ['timeout', 'GitHub did not respond in time'],
    ['network', 'Could not reach GitHub'],
    ['budget_exhausted', 'Analysis exceeded its request budget'],
  ] as const)('gives %s its own explanation', (kind, heading) => {
    render(<AnalysisError error={new GitHubError(kind, 'x')} repository="acme/widget" />);
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
  });

  it('handles an error it does not recognize without leaking details', () => {
    const secret = 'Error: connect ECONNREFUSED 10.0.0.5:5432 password=hunter2';
    render(<AnalysisError error={new Error(secret)} repository="acme/widget" />);

    expect(
      screen.getByRole('heading', { name: 'Analysis could not be completed' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/hunter2/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
  });

  it('always offers a way forward', () => {
    render(<AnalysisError error={new Error('x')} repository="acme/widget" />);
    expect(
      screen.getByRole('link', { name: /analyze a different repository/i }),
    ).toHaveAttribute('href', '/');
  });
});
