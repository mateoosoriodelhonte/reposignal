import type { AnalysisResult, CategoryScore, Severity } from '@/types/analysis';
import type { RepositorySnapshot } from '@/types/snapshot';

import { scoreActivity } from './activity';
import { scoreCi } from './ci';
import { scoreDocumentation } from './documentation';
import { scoreIssues } from './issues';
import { scoreOverall } from './overall';
import { scorePullRequests } from './pull-requests';
import { scoreRepository } from './repository';
import { scoreSecurity } from './security';
import { SCORING_VERSION } from './weights';

export { SCORING_VERSION } from './weights';

const SEVERITY_ORDER: Record<Severity, number> = {
  high: 0,
  medium: 1,
  low: 2,
  info: 3,
};

/**
 * Runs every category scorer over a snapshot and combines the results.
 *
 * Pure: given the same snapshot, `now`, and `analysisId`, this returns the same
 * result forever. That is what makes the scoring engine testable without a
 * network and what lets a stored analysis stay interpretable.
 */
export function analyzeSnapshot(
  snapshot: RepositorySnapshot,
  options: { now: Date; analysisId: string },
): AnalysisResult {
  const categories: CategoryScore[] = [
    scoreActivity(snapshot, options.now),
    scorePullRequests(snapshot),
    scoreIssues(snapshot),
    scoreCi(snapshot),
    scoreDocumentation(snapshot),
    scoreRepository(snapshot),
    scoreSecurity(snapshot),
  ];

  const overall = scoreOverall(categories);

  const findings = categories
    .flatMap((category) => category.findings)
    .sort((a, b) => {
      const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      return bySeverity !== 0 ? bySeverity : a.category.localeCompare(b.category);
    });

  const limitations: string[] = [];

  for (const failure of snapshot.collection.failures) {
    limitations.push(
      `Could not retrieve ${failure.resource} from GitHub (${failure.reason}). Anything derived from it was excluded rather than assumed.`,
    );
  }

  if (snapshot.identity.isFork) {
    limitations.push(
      'This repository is a fork. Activity and contribution signals may reflect the upstream project rather than work done here.',
    );
  }

  return {
    scoringVersion: SCORING_VERSION,
    analysisId: options.analysisId,
    analyzedAt: snapshot.capturedAt,
    repository: snapshot.identity,
    overall,
    categories,
    findings,
    limitations,
  };
}

export {
  scoreActivity,
  scoreCi,
  scoreDocumentation,
  scoreIssues,
  scoreOverall,
  scorePullRequests,
  scoreRepository,
  scoreSecurity,
};
