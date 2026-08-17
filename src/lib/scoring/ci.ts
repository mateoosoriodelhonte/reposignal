import type { CategoryScore, Finding } from '@/types/analysis';
import type { RepositorySnapshot, WorkflowConclusion } from '@/types/snapshot';

import {
  combine,
  component,
  describeFormula,
  deriveConfidence,
  metric,
} from './primitives';
import { CATEGORY_LABELS } from './weights';

/**
 * CI health scoring.
 *
 * This is the category where an unavailability-means-failure bug would do the
 * most damage, so the distinctions are drawn explicitly:
 *
 * - **Unreadable CI data** → `null`. Not a failure.
 * - **No CI configured** → a configuration finding, scored on the absence of
 *   configuration. Clearly distinct from configured-but-failing.
 * - **Configured and failing** → a run-outcome finding.
 *
 * `cancelled` and `skipped` runs are excluded from the success rate rather
 * than counted as failures. A cancelled run is a superseded run, and counting
 * it as a failure would penalize exactly the projects that cancel outdated
 * runs to save CI minutes.
 */

/** Consecutive failures on the default branch before it is worth reporting. */
export const CONSECUTIVE_FAILURE_THRESHOLD = 3;

/** Conclusions that represent a real pass/fail signal. */
const DECISIVE: WorkflowConclusion[] = [
  'success',
  'failure',
  'timed_out',
  'startup_failure',
];

const SUCCESSFUL: WorkflowConclusion[] = ['success'];

/** Leading failures in a newest-first run list. */
export function countLeadingFailures(conclusions: WorkflowConclusion[]): number {
  let count = 0;
  for (const conclusion of conclusions) {
    // Skipped and cancelled runs neither break nor continue a failure streak.
    if (conclusion === 'skipped' || conclusion === 'cancelled') continue;
    if (DECISIVE.includes(conclusion) && !SUCCESSFUL.includes(conclusion)) {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

export function scoreCi(snapshot: RepositorySnapshot): CategoryScore {
  const ci = snapshot.ci;
  const repoUrl = snapshot.identity.htmlUrl;

  const decisiveRuns = ci.recentRunConclusions.filter((c) => DECISIVE.includes(c));
  const successCount = decisiveRuns.filter((c) => SUCCESSFUL.includes(c)).length;
  const successRate =
    decisiveRuns.length === 0 ? null : successCount / decisiveRuns.length;

  const hasWorkflows = ci.workflowCount !== null && ci.workflowCount > 0;
  const hasCommitStatus =
    ci.latestCommitStatus !== null && ci.latestCommitStatus !== 'none';

  // Nothing observable at all: no workflow information and no commit status.
  // This is "we could not tell", which is not the same as "no CI".
  if (ci.workflowCount === null && !hasCommitStatus) {
    return {
      key: 'ci',
      label: CATEGORY_LABELS.ci,
      score: null,
      confidence: 'low',
      metrics: [
        metric('ci.workflows.count', 'Workflows', null, {
          unknownReason: 'not_retrieved',
        }),
        metric('ci.runs.successRate', 'Recent run success rate', null, {
          unknownReason: 'not_retrieved',
        }),
      ],
      findings: [
        {
          id: 'ci.unavailable',
          category: 'ci',
          severity: 'info',
          title: 'CI information could not be read',
          explanation:
            'RepoSignal could not read workflow or check information for this repository. This is an absence of data, not evidence that CI is missing or failing, so this category was excluded from the overall score.',
          metric: { workflowCount: null },
          recommendation: 'No action implied.',
          confidence: 'high',
          evidenceUrl: `${repoUrl}/actions`,
        },
      ],
      explanation: {
        summary: 'Not scored: CI information could not be read from public GitHub data.',
        formula: 'Not applicable — excluded from the overall score.',
        components: [],
        limitations: [
          'Workflow and check information was not retrievable. This category was excluded from the overall score rather than scored as zero, because unavailable data is not evidence of a failing or absent pipeline.',
        ],
      },
    };
  }

  const findings: Finding[] = [];

  // Readable, and there is genuinely no CI configured. That is a real
  // observation, and it is scored on configuration — not on run outcomes.
  if (ci.workflowCount === 0 && !hasCommitStatus) {
    findings.push({
      id: 'ci.notConfigured',
      category: 'ci',
      severity: 'medium',
      title: 'No continuous integration configured',
      explanation:
        'No GitHub Actions workflows and no commit status checks were found. Changes are not verified automatically before they land, so regressions surface after merge rather than before.',
      metric: { workflowCount: 0 },
      recommendation:
        'Add a workflow that runs the test suite and a build on every pull request.',
      confidence: 'high',
      evidenceUrl: `${repoUrl}/actions`,
    });

    const configurationComponent = component(
      'ci.configured',
      'CI configured',
      0,
      100,
      'No workflows and no commit status checks',
      'CI configured scores 100, none scores 0.',
    );

    return {
      key: 'ci',
      label: CATEGORY_LABELS.ci,
      score: 0,
      confidence: 'high',
      metrics: [
        metric('ci.workflows.count', 'Workflows', 0),
        metric('ci.runs.successRate', 'Recent run success rate', null, {
          unknownReason: 'not_applicable',
        }),
      ],
      findings,
      explanation: {
        summary: 'No CI is configured on this repository.',
        formula: describeFormula([configurationComponent]),
        components: [configurationComponent],
        limitations: [
          'Only GitHub Actions workflows and commit status checks are visible. A project using external CI that does not report status back to GitHub would appear to have none.',
        ],
      },
    };
  }

  const consecutiveFailures = countLeadingFailures(ci.recentRunConclusions);

  const components = [
    component(
      'ci.configured',
      'CI configured',
      hasWorkflows || hasCommitStatus ? 100 : 0,
      30,
      hasWorkflows
        ? `${ci.workflowCount} workflow${ci.workflowCount === 1 ? '' : 's'}`
        : 'Commit status checks present',
      'Workflows or commit status checks present scores 100.',
    ),
    component(
      'ci.successRate',
      'Recent run success rate',
      successRate === null ? null : Math.round(successRate * 100),
      45,
      successRate === null
        ? 'No decisive runs in the sample'
        : `${successCount} of ${decisiveRuns.length} recent runs succeeded (${Math.round(successRate * 100)}%)`,
      'Successful runs divided by decisive runs on the default branch. Cancelled and skipped runs are excluded rather than counted as failures.',
    ),
    component(
      'ci.latestStatus',
      'Latest commit status',
      latestStatusScore(ci.latestCommitStatus),
      25,
      ci.latestCommitStatus === null || ci.latestCommitStatus === 'none'
        ? 'No status on the latest default-branch commit'
        : `Latest commit status: ${ci.latestCommitStatus}`,
      'Success scores 100, pending scores 70, failure scores 0. No status is not scorable and its weight is redistributed.',
    ),
  ];

  const { score, scoredWeight, totalWeight } = combine(components);

  if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
    findings.push({
      id: 'ci.consecutiveFailures',
      category: 'ci',
      severity: 'high',
      title: 'Recent CI runs are failing consecutively',
      explanation: `The ${consecutiveFailures} most recent decisive workflow runs on the default branch all failed. A persistently red default branch means CI has stopped functioning as a signal — contributors cannot tell whether their change broke something.`,
      metric: {
        consecutiveFailures,
        threshold: CONSECUTIVE_FAILURE_THRESHOLD,
      },
      recommendation:
        'Fix or quarantine the failing job so a red run means something again.',
      confidence: 'high',
      evidenceUrl: `${repoUrl}/actions`,
    });
  } else if (successRate !== null && successRate < 0.7 && decisiveRuns.length >= 10) {
    findings.push({
      id: 'ci.lowSuccessRate',
      category: 'ci',
      severity: 'medium',
      title: 'CI fails often',
      explanation: `${successCount} of the ${decisiveRuns.length} recent decisive runs on the default branch succeeded (${Math.round(successRate * 100)}%). Frequent failures on the default branch make it hard to tell a real regression from routine noise.`,
      metric: {
        successfulRuns: successCount,
        decisiveRuns: decisiveRuns.length,
        successRate: Number(successRate.toFixed(2)),
      },
      recommendation:
        'Investigate whether failures are genuine regressions or flaky tests, and address the flakiness directly.',
      confidence: ci.sample.truncated ? 'medium' : 'high',
      evidenceUrl: `${repoUrl}/actions`,
    });
  }

  const limitations = [
    'Only GitHub Actions workflows and commit status checks are visible. A project using external CI that does not report status back to GitHub would appear to have none.',
    'Cancelled and skipped runs are excluded from the success rate rather than counted as failures, since a cancelled run is usually a superseded one.',
    'Run outcomes are read from the default branch only.',
  ];

  if (ci.sample.truncated) {
    limitations.push(
      'More workflow runs exist than were examined, so the success rate describes the sample rather than the full history.',
    );
  }

  return {
    key: 'ci',
    label: CATEGORY_LABELS.ci,
    score,
    confidence: deriveConfidence({
      scoredWeight,
      totalWeight,
      samples: [ci.sample],
    }),
    metrics: [
      metric('ci.workflows.count', 'Workflows', ci.workflowCount, {
        unknownReason: 'not_retrieved',
      }),
      metric('ci.runs.examined', 'Recent runs examined', ci.recentRunConclusions.length),
      metric('ci.runs.decisive', 'Runs with a decisive outcome', decisiveRuns.length),
      metric(
        'ci.runs.successRate',
        'Recent run success rate',
        successRate === null ? null : Math.round(successRate * 100),
        { unit: '%', unknownReason: 'insufficient_data' },
      ),
      metric(
        'ci.runs.consecutiveFailures',
        'Consecutive recent failures',
        consecutiveFailures,
      ),
      metric('ci.latestCommitStatus', 'Latest commit status', ci.latestCommitStatus, {
        unknownReason: 'not_retrieved',
      }),
    ],
    findings,
    explanation: {
      summary:
        'Measures whether automated checks exist and whether they are passing, using workflow runs on the default branch and the status of its most recent commit.',
      formula: describeFormula(components),
      components,
      limitations,
    },
  };
}

function latestStatusScore(
  status: RepositorySnapshot['ci']['latestCommitStatus'],
): number | null {
  switch (status) {
    case 'success':
      return 100;
    case 'pending':
      return 70;
    case 'failure':
      return 0;
    case 'none':
    case null:
      // No status is not a failed status.
      return null;
    default:
      return null;
  }
}
