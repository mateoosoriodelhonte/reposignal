import type { CategoryKey } from '@/types/analysis';

/**
 * The scoring algorithm version.
 *
 * Every stored analysis records this. Any change to a weight, threshold, or
 * formula anywhere in `src/lib/scoring` requires bumping it and adding an
 * entry to `docs/SCORING.md`, so a historical result stays interpretable
 * against the rules that produced it.
 */
export const SCORING_VERSION = '1.0.0';

/**
 * Declared category weights, summing to 100.
 *
 * Six categories are weighted equally at 15 because RepoSignal has no evidence
 * that any one dimension of engineering health predicts another better —
 * asserting otherwise would be fabricated precision. Security Hygiene is
 * weighted lower at 10 because it observes the fewest independent signals, so
 * a single missing file moves it further than it should move a total.
 */
export const CATEGORY_WEIGHTS: Record<CategoryKey, number> = {
  activity: 15,
  pullRequests: 15,
  issues: 15,
  ci: 15,
  documentation: 15,
  repository: 15,
  security: 10,
};

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  activity: 'Repository Activity',
  pullRequests: 'Pull Request Health',
  issues: 'Issue Health',
  ci: 'CI Health',
  documentation: 'Documentation',
  repository: 'Repository Hygiene',
  // Deliberately "Hygiene", never "Score": RepoSignal observes practices, not
  // security posture, and the name is part of not overstating that.
  security: 'Security Hygiene',
};

/**
 * Below this many scored categories, the overall score is `null`.
 *
 * Averaging two categories and presenting the result as an engineering health
 * score implies far more coverage than three of fourteen possible signals
 * provide.
 */
export const MINIMUM_SCORED_CATEGORIES = 3;
