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
 * Issue health scoring.
 *
 * Every statement this module makes is an observation. "37 issues have had no
 * activity for more than 180 days" is a fact about the data. "The maintainers
 * are ignoring the backlog" is a claim about intent, which RepoSignal cannot
 * observe and will not make. A large stale backlog on a finished, stable
 * library means something quite different than on an actively marketed one,
 * and RepoSignal cannot tell those apart.
 */

/**
 * An issue with no activity beyond this is stale.
 *
 * 180 days is chosen because it survives a normal release cycle and a quiet
 * summer. Shorter thresholds flag healthy projects that batch triage; longer
 * ones stop distinguishing anything.
 */
export const STALE_ISSUE_DAYS = 180;

/** Bands for the proportion of open issues that are stale. Lower is better. */
const STALE_RATIO_BANDS = [
  { upTo: 0.1, score: 100, label: 'Under 10% stale' },
  { upTo: 0.25, score: 85, label: 'Under 25% stale' },
  { upTo: 0.5, score: 60, label: 'Under 50% stale' },
  { upTo: 0.75, score: 35, label: 'Under 75% stale' },
  { upTo: Infinity, score: 15, label: '75% or more stale' },
];

/** Bands for median open-issue age in days. Lower is better. */
const MEDIAN_AGE_BANDS = [
  { upTo: 30, score: 100, label: 'Median under 30 days' },
  { upTo: 90, score: 85, label: 'Median under 90 days' },
  { upTo: 180, score: 65, label: 'Median under 180 days' },
  { upTo: 365, score: 45, label: 'Median under a year' },
  { upTo: Infinity, score: 25, label: 'Median over a year' },
];

export function scoreIssues(snapshot: RepositorySnapshot): CategoryScore {
  const issues = snapshot.issues;
  const repoUrl = snapshot.identity.htmlUrl;

  // Issues disabled is "not applicable", not "a perfect backlog" and not
  // "zero". The category scores null and its weight is redistributed.
  if (issues === null) {
    return {
      key: 'issues',
      label: CATEGORY_LABELS.issues,
      score: null,
      confidence: 'high',
      metrics: [
        metric('issues.enabled', 'Issues enabled', 'false'),
        metric('issues.open.count', 'Open issues', null, {
          unknownReason: 'not_applicable',
        }),
      ],
      findings: [
        {
          id: 'issues.disabled',
          category: 'issues',
          severity: 'info',
          title: 'Issues are disabled',
          explanation:
            'This repository has GitHub Issues turned off, so there is no issue backlog to assess. Many projects track work elsewhere; this is not itself a problem.',
          metric: { issuesEnabled: 'false' },
          recommendation:
            'No action implied. If the project tracks issues elsewhere, linking to that from the README helps visitors.',
          confidence: 'high',
          evidenceUrl: repoUrl,
        },
      ],
      explanation: {
        summary: 'Not scored: this repository has issues disabled.',
        formula: 'Not applicable — excluded from the overall score.',
        components: [],
        limitations: [
          'Issues are disabled on this repository, so issue health could not be assessed. This category was excluded from the overall score rather than scored as zero.',
        ],
      },
    };
  }

  const staleCount = issues.openInactiveDays.filter(
    (days) => days >= STALE_ISSUE_DAYS,
  ).length;
  const staleRatio = proportionAtLeast(issues.openInactiveDays, STALE_ISSUE_DAYS);
  const medianAge = median(issues.openAgeDays);

  const stale = scoreDescending(staleRatio, STALE_RATIO_BANDS);
  const age = scoreDescending(medianAge, MEDIAN_AGE_BANDS);

  // Closing at least as many issues as are opened means the backlog is not
  // growing. Above 1.0 it is shrinking, which is capped at 100.
  const closeRatio =
    issues.createdLast90Days === 0
      ? issues.closedLast90Days > 0
        ? 1
        : null
      : issues.closedLast90Days / issues.createdLast90Days;

  const responsiveness =
    closeRatio === null ? null : Math.round(Math.min(1, closeRatio) * 100);

  const components = [
    component(
      'issues.staleRatio',
      'Stale issue proportion',
      stale.score,
      40,
      staleRatio === null
        ? 'No open issues to assess'
        : `${staleCount} of ${issues.openInactiveDays.length} open issues inactive for ${STALE_ISSUE_DAYS}+ days (${Math.round(staleRatio * 100)}%)`,
      `Proportion of open issues with no activity for ${STALE_ISSUE_DAYS}+ days. ${stale.label}.`,
    ),
    component(
      'issues.medianAge',
      'Median open issue age',
      age.score,
      30,
      medianAge === null ? 'No open issues to assess' : `${medianAge} days`,
      `Median age of open issues. ${age.label}.`,
    ),
    component(
      'issues.responsiveness',
      'Close rate against open rate',
      responsiveness,
      30,
      closeRatio === null
        ? 'No issue activity in the last 90 days'
        : `${issues.closedLast90Days} closed against ${issues.createdLast90Days} opened in 90 days`,
      'Issues closed divided by issues opened over the trailing 90 days, capped at 1.0. A ratio at or above 1.0 means the backlog is not growing.',
    ),
  ];

  const { score, scoredWeight, totalWeight } = combine(components);
  const findings: Finding[] = [];

  const staleQuery = `${repoUrl}/issues?q=${encodeURIComponent(
    `is:issue is:open updated:<${isoDaysBefore(snapshot.capturedAt, STALE_ISSUE_DAYS)}`,
  )}`;

  if (staleCount > 0 && staleRatio !== null && staleRatio >= 0.25) {
    findings.push({
      id: 'issues.stale.backlog',
      category: 'issues',
      severity: staleRatio >= 0.5 ? 'high' : 'medium',
      title: 'Large proportion of stale issues',
      explanation: `${staleCount} of the ${issues.openInactiveDays.length} open issues examined have had no activity for more than ${STALE_ISSUE_DAYS} days. A large stale queue makes prioritization harder and can make a project look unmaintained to a newcomer, whatever the reality.`,
      metric: {
        staleIssues: staleCount,
        openIssuesExamined: issues.openInactiveDays.length,
        thresholdDays: STALE_ISSUE_DAYS,
        stalePercentage: Math.round(staleRatio * 100),
      },
      recommendation:
        'Review stale issues and classify them — still relevant, needs information, or out of scope. Closing in bulk without reading loses real reports.',
      confidence: issues.sample.truncated ? 'medium' : 'high',
      evidenceUrl: staleQuery,
    });
  }

  if (closeRatio !== null && closeRatio < 0.5 && issues.createdLast90Days >= 10) {
    findings.push({
      id: 'issues.backlog.growing',
      category: 'issues',
      severity: 'medium',
      title: 'Issue backlog is growing',
      explanation: `Over the last 90 days, ${issues.createdLast90Days} issues were opened and ${issues.closedLast90Days} were closed. At this rate the backlog grows faster than it is resolved.`,
      metric: {
        openedLast90Days: issues.createdLast90Days,
        closedLast90Days: issues.closedLast90Days,
        ratio: Number(closeRatio.toFixed(2)),
      },
      recommendation:
        'Consider whether triage capacity matches inbound volume — through templates that reduce back-and-forth, or more contributors with triage rights.',
      confidence: issues.sample.truncated ? 'medium' : 'high',
      evidenceUrl: `${repoUrl}/issues`,
    });
  }

  if (issues.openCount === 0) {
    findings.push({
      id: 'issues.backlog.empty',
      category: 'issues',
      severity: 'info',
      title: 'No open issues',
      explanation:
        'The repository has no open issues. That can mean a well-maintained backlog, or that users report problems elsewhere.',
      metric: { openIssues: 0 },
      recommendation: 'No action implied.',
      confidence: 'high',
      evidenceUrl: `${repoUrl}/issues`,
    });
  }

  return {
    key: 'issues',
    label: CATEGORY_LABELS.issues,
    score,
    confidence: deriveConfidence({
      scoredWeight,
      totalWeight,
      samples: [issues.sample],
    }),
    metrics: [
      metric('issues.open.count', 'Open issues examined', issues.openCount),
      metric('issues.stale.count', 'Stale issues', staleCount),
      metric('issues.stale.thresholdDays', 'Stale threshold', STALE_ISSUE_DAYS, {
        unit: 'days',
      }),
      metric('issues.medianAge', 'Median open issue age', medianAge, {
        unit: 'days',
        unknownReason: 'insufficient_data',
      }),
      metric('issues.opened90d', 'Opened in last 90 days', issues.createdLast90Days),
      metric('issues.closed90d', 'Closed in last 90 days', issues.closedLast90Days),
      metric('issues.sample.examined', 'Issues examined', issues.sample.examined),
      metric(
        'issues.sample.truncated',
        'Sample truncated',
        String(issues.sample.truncated),
      ),
    ],
    findings,
    explanation: {
      summary:
        'Measures whether the issue backlog is being tended: how much of it is stale, how old it is, and whether issues are closed as fast as they arrive.',
      formula: describeFormula(components),
      components,
      limitations: [
        `Based on a sample of up to 300 issues${issues.sample.truncated ? ', which was truncated for this repository' : ''}. Counts describe what was examined, not necessarily the full backlog.`,
        'Pull requests are excluded, since GitHub returns them from the same endpoint.',
        'RepoSignal reports observed activity only. It cannot tell a neglected issue from one deliberately left open as a known limitation.',
        'A stale backlog on a stable, finished project means something different than on an actively developed one. This distinction is not observable from the data.',
      ],
    },
  };
}

/** ISO date `days` before a reference timestamp, for a GitHub search query. */
function isoDaysBefore(reference: string, days: number): string {
  const date = new Date(reference);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
