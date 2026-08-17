import type { CategoryScore, Confidence, OverallScore } from '@/types/analysis';

import { CATEGORY_WEIGHTS, MINIMUM_SCORED_CATEGORIES } from './weights';

/**
 * Combines category scores into one number.
 *
 * This is the most important twelve lines in the project, because it is where
 * the null-preservation rule either holds or quietly breaks.
 *
 * A category that returned `null` is **excluded**, and its declared weight is
 * redistributed proportionally across the categories that did produce a score.
 * The consequence, asserted directly by a regression test: adding a null
 * category can never lower the overall score.
 *
 * If missing categories were instead scored as zero, a repository with issues
 * disabled would be punished for a setting, and one whose commit statistics
 * GitHub had not computed would be punished for GitHub's queue.
 */
export function scoreOverall(categories: CategoryScore[]): OverallScore {
  const scored = categories.filter(
    (category): category is CategoryScore & { score: number } => category.score !== null,
  );

  const excluded = categories
    .filter((category) => category.score === null)
    .map((category) => ({
      key: category.key,
      reason: excludedReason(category),
    }));

  // Below the minimum, an average would imply far more coverage than the
  // evidence supports, so no number is reported at all.
  if (scored.length < MINIMUM_SCORED_CATEGORIES) {
    return {
      score: null,
      confidence: 'low',
      contributions: [],
      excluded,
      formula: `Not scored: ${scored.length} of ${categories.length} categories produced a score, below the minimum of ${MINIMUM_SCORED_CATEGORIES} required to report an overall number.`,
    };
  }

  const scoredWeight = scored.reduce(
    (sum, category) => sum + CATEGORY_WEIGHTS[category.key],
    0,
  );

  const contributions = scored.map((category) => {
    const declaredWeight = CATEGORY_WEIGHTS[category.key];
    return {
      key: category.key,
      score: category.score,
      declaredWeight,
      // Renormalized so the effective weights sum to 100 across whatever was
      // actually scorable.
      effectiveWeight: Number(((declaredWeight / scoredWeight) * 100).toFixed(1)),
    };
  });

  const weighted = scored.reduce(
    (sum, category) => sum + category.score * CATEGORY_WEIGHTS[category.key],
    0,
  );

  const terms = contributions
    .map((c) => `${c.score} × ${(c.effectiveWeight / 100).toFixed(3)}`)
    .join(' + ');

  const note =
    excluded.length === 0
      ? ''
      : ` ${excluded.length} categor${excluded.length === 1 ? 'y' : 'ies'} could not be scored and ${excluded.length === 1 ? 'its weight was' : 'their weights were'} redistributed across the rest, never counted as zero.`;

  return {
    score: Math.round(weighted / scoredWeight),
    confidence: deriveOverallConfidence(scored, scoredWeight),
    contributions,
    excluded,
    formula: `${terms}.${note}`,
  };
}

/**
 * Overall confidence, from two independent inputs: how much of the declared
 * weight was scorable, and how confident the scored categories themselves are.
 * The lower of the two governs — a total built from confident categories that
 * only cover half the picture is not a confident total.
 */
function deriveOverallConfidence(
  scored: CategoryScore[],
  scoredWeight: number,
): Confidence {
  const totalWeight = Object.values(CATEGORY_WEIGHTS).reduce((sum, w) => sum + w, 0);
  const coverage = scoredWeight / totalWeight;

  const rank: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
  const worstCategory = scored.reduce<Confidence>(
    (worst, category) =>
      rank[category.confidence] < rank[worst] ? category.confidence : worst,
    'high',
  );

  const coverageConfidence: Confidence =
    coverage >= 0.85 ? 'high' : coverage >= 0.6 ? 'medium' : 'low';

  return rank[coverageConfidence] < rank[worstCategory]
    ? coverageConfidence
    : worstCategory;
}

/** Human-readable reason a category was excluded, taken from its explanation. */
function excludedReason(category: CategoryScore): string {
  return (
    category.explanation.limitations[0] ??
    'This category could not be scored from the available data.'
  );
}

/**
 * Asserts the declared weights sum to 100.
 *
 * Called by a test rather than at runtime — a weight table that does not sum
 * to 100 is a bug to catch in CI, not a condition to handle in production.
 */
export function totalDeclaredWeight(): number {
  return Object.values(CATEGORY_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
}
