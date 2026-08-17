import { median, proportionAtLeast } from '@/lib/normalize/dates';
import type { CategoryScore, Finding } from '@/types/analysis';
import type { RepositorySnapshot } from '@/types/snapshot';

import {
  combine,
  component,
  describeFormula,
  deriveConfidence,
  metric,
  scoreDescending,
} from './primitives';
import { CATEGORY_LABELS } from './weights';

/**
 * Pull request health scoring.
 *
 * Everything here is derived from a bounded sample of recent pull requests, so
 * every derived metric is approximate and is labelled as such in the UI. The
 * alternative — enumerating every PR on a large repository — would cost
 * hundreds of requests for precision that does not change any conclusion.
 *
 * Merge duration uses the median rather than the mean, because one PR left
 * open for four years and then merged would otherwise make a fast-merging
 * project look slow.
 */

/** An open PR older than this is long-lived. */
export const LONG_LIVED_PR_DAYS = 90;

/** Bands for the proportion of open PRs that are long-lived. Lower is better. */
const LONG_LIVED_RATIO_BANDS = [
  { upTo: 0.1, score: 100, label: 'Under 10% long-lived' },
  { upTo: 0.25, score: 85, label: 'Under 25% long-lived' },
  { upTo: 0.5, score: 60, label: 'Under 50% long-lived' },
  { upTo: 0.75, score: 35, label: 'Under 75% long-lived' },
  { upTo: Infinity, score: 15, label: '75% or more long-lived' },
];

/** Bands for median days from opening to merge. Lower is better. */
const MERGE_DURATION_BANDS = [
  { upTo: 2, score: 100, label: 'Median under 2 days' },
  { upTo: 7, score: 90, label: 'Median under a week' },
  { upTo: 30, score: 70, label: 'Median under a month' },
  { upTo: 90, score: 45, label: 'Median under 3 months' },
  { upTo: Infinity, score: 25, label: 'Median over 3 months' },
];

export function scorePullRequests(snapshot: RepositorySnapshot): CategoryScore {
  const prs = snapshot.pullRequests;
  const repoUrl = snapshot.identity.htmlUrl;

  // Never having had a pull request is not the same as never merging one.
  if (prs === null) {
    return {
      key: 'pullRequests',
      label: CATEGORY_LABELS.pullRequests,
      score: null,
      confidence: 'high',
      metrics: [
        metric('pullRequests.total', 'Pull requests examined', 0),
        metric('pullRequests.open.count', 'Open pull requests', null, {
          unknownReason: 'insufficient_data',
        }),
      ],
      findings: [
        {
          id: 'pullRequests.none',
          category: 'pullRequests',
          severity: 'info',
          title: 'No pull requests found',
          explanation:
            'RepoSignal found no pull requests on this repository. That is normal for a project developed by pushing directly to a branch, and says nothing about how changes are reviewed.',
          metric: { pullRequestsExamined: 0 },
          recommendation: 'No action implied.',
          confidence: 'high',
          evidenceUrl: `${repoUrl}/pulls`,
        },
      ],
      explanation: {
        summary: 'Not scored: no pull requests were found.',
        formula: 'Not applicable — excluded from the overall score.',
        components: [],
        limitations: [
          'No pull requests were found, so pull request health could not be assessed. This category was excluded from the overall score rather than scored as zero.',
        ],
      },
    };
  }

  const longLivedCount = prs.openAgeDays.filter(
    (days) => days >= LONG_LIVED_PR_DAYS,
  ).length;
  const longLivedRatio = proportionAtLeast(prs.openAgeDays, LONG_LIVED_PR_DAYS);
  const medianMergeDays = median(prs.mergedDurationDays);

  const longLived = scoreDescending(longLivedRatio, LONG_LIVED_RATIO_BANDS);
  const mergeSpeed = scoreDescending(medianMergeDays, MERGE_DURATION_BANDS);

  const decided = prs.recentlyMergedCount + prs.recentlyClosedUnmergedCount;
  const mergeRate = decided === 0 ? null : prs.recentlyMergedCount / decided;
  const mergeRateScore = mergeRate === null ? null : Math.round(mergeRate * 100);

  const components = [
    component(
      'pullRequests.longLivedRatio',
      'Long-lived open pull requests',
      longLived.score,
      35,
      longLivedRatio === null
        ? 'No open pull requests to assess'
        : `${longLivedCount} of ${prs.openAgeDays.length} open PRs older than ${LONG_LIVED_PR_DAYS} days (${Math.round(longLivedRatio * 100)}%)`,
      `Proportion of open pull requests older than ${LONG_LIVED_PR_DAYS} days. ${longLived.label}.`,
    ),
    component(
      'pullRequests.mergeDuration',
      'Median time to merge (approximate)',
      mergeSpeed.score,
      35,
      medianMergeDays === null
        ? 'No merged pull requests in the sample'
        : `${medianMergeDays} days (median of ${prs.mergedDurationDays.length} merged PRs sampled)`,
      `Median days from opening to merge across the sample. ${mergeSpeed.label}. Median is used so a single very old merge cannot distort the result.`,
    ),
    component(
      'pullRequests.mergeRate',
      'Merged share of decided pull requests',
      mergeRateScore,
      30,
      decided === 0
        ? 'No pull requests were decided in the last 90 days'
        : `${prs.recentlyMergedCount} merged, ${prs.recentlyClosedUnmergedCount} closed unmerged, in the last 90 days`,
      'Merged divided by merged-plus-closed-unmerged over the trailing 90 days.',
    ),
  ];

  const { score, scoredWeight, totalWeight } = combine(components);
  const findings: Finding[] = [];

  if (longLivedRatio !== null && longLivedRatio >= 0.25 && longLivedCount > 0) {
    findings.push({
      id: 'pullRequests.longLived',
      category: 'pullRequests',
      severity: longLivedRatio >= 0.5 ? 'high' : 'medium',
      title: 'Many long-lived open pull requests',
      explanation: `${longLivedCount} of the ${prs.openAgeDays.length} open pull requests examined have been open for more than ${LONG_LIVED_PR_DAYS} days. Long-lived branches drift from the default branch and become progressively harder to merge.`,
      metric: {
        longLivedPullRequests: longLivedCount,
        openPullRequestsExamined: prs.openAgeDays.length,
        thresholdDays: LONG_LIVED_PR_DAYS,
      },
      recommendation:
        'Review the oldest open pull requests and either progress them, request the changes needed, or close them with an explanation.',
      confidence: prs.sample.truncated ? 'medium' : 'high',
      evidenceUrl: `${repoUrl}/pulls?q=${encodeURIComponent('is:pr is:open sort:created-asc')}`,
    });
  }

  if (
    medianMergeDays !== null &&
    medianMergeDays > 30 &&
    prs.mergedDurationDays.length >= 5
  ) {
    findings.push({
      id: 'pullRequests.slowMerge',
      category: 'pullRequests',
      severity: 'low',
      title: 'Pull requests take a long time to merge',
      explanation: `Across the ${prs.mergedDurationDays.length} merged pull requests sampled, the median time from opening to merge was ${medianMergeDays} days. This is an approximation from recent pull requests, not a complete history.`,
      metric: {
        medianMergeDays,
        mergedPullRequestsSampled: prs.mergedDurationDays.length,
      },
      recommendation:
        'If contributions are expected, a documented review turnaround helps contributors know what to expect.',
      confidence: prs.sample.truncated ? 'medium' : 'high',
      evidenceUrl: `${repoUrl}/pulls?q=${encodeURIComponent('is:pr is:merged')}`,
    });
  }

  if (decided >= 10 && mergeRate !== null && mergeRate < 0.3) {
    findings.push({
      id: 'pullRequests.lowMergeRate',
      category: 'pullRequests',
      severity: 'low',
      title: 'Most recent pull requests were closed without merging',
      explanation: `Of the ${decided} pull requests decided in the last 90 days, ${prs.recentlyClosedUnmergedCount} were closed without merging. This is an observation about outcomes, not about whether those decisions were correct — declining out-of-scope contributions is legitimate maintenance.`,
      metric: {
        merged: prs.recentlyMergedCount,
        closedUnmerged: prs.recentlyClosedUnmergedCount,
        mergeRate: Number(mergeRate.toFixed(2)),
      },
      recommendation:
        'If contributions are welcome, documenting what is in scope before someone writes code saves everyone effort.',
      confidence: prs.sample.truncated ? 'medium' : 'high',
      evidenceUrl: `${repoUrl}/pulls?q=${encodeURIComponent('is:pr is:closed is:unmerged')}`,
    });
  }

  return {
    key: 'pullRequests',
    label: CATEGORY_LABELS.pullRequests,
    score,
    confidence: deriveConfidence({
      scoredWeight,
      totalWeight,
      samples: [prs.sample],
    }),
    metrics: [
      metric('pullRequests.open.count', 'Open pull requests examined', prs.openCount),
      metric(
        'pullRequests.longLived.count',
        'Long-lived open pull requests',
        longLivedCount,
      ),
      metric(
        'pullRequests.longLived.thresholdDays',
        'Long-lived threshold',
        LONG_LIVED_PR_DAYS,
        {
          unit: 'days',
        },
      ),
      metric(
        'pullRequests.medianMergeDays',
        'Median time to merge (approximate)',
        medianMergeDays,
        { unit: 'days', unknownReason: 'insufficient_data' },
      ),
      metric('pullRequests.merged90d', 'Merged in last 90 days', prs.recentlyMergedCount),
      metric(
        'pullRequests.closedUnmerged90d',
        'Closed unmerged in last 90 days',
        prs.recentlyClosedUnmergedCount,
      ),
      metric(
        'pullRequests.sample.examined',
        'Pull requests examined',
        prs.sample.examined,
      ),
      metric(
        'pullRequests.sample.truncated',
        'Sample truncated',
        String(prs.sample.truncated),
      ),
    ],
    findings,
    explanation: {
      summary:
        'Measures how pull requests move: how many sit open for a long time, how quickly they are merged, and what share of decided pull requests were merged.',
      formula: describeFormula(components),
      components,
      limitations: [
        `Based on a sample of up to 200 recent pull requests${prs.sample.truncated ? ', which was truncated for this repository' : ''}. Every derived figure is approximate.`,
        'Review latency and approval counts are not measured; reading them costs more requests than the analysis budget allows.',
        'RepoSignal reports observed outcomes only. A pull request closed without merging may have been correctly declined, and that distinction is not observable.',
        'Draft pull requests are counted as open, since GitHub reports them that way.',
      ],
    },
  };
}
