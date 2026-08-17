/**
 * Domain types for RepoSignal.
 *
 * Nothing in this file references GitHub API response shapes. The
 * normalization layer is the only place allowed to know what GitHub's JSON
 * looks like; everything downstream works with these types.
 */

export const CATEGORY_KEYS = [
  'activity',
  'pullRequests',
  'issues',
  'ci',
  'documentation',
  'repository',
  'security',
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export type Severity = 'info' | 'low' | 'medium' | 'high';

/**
 * How completely the underlying data was observed.
 *
 * This is deliberately distinct from severity. A `high` severity finding built
 * from a truncated sample is still only `medium` confidence.
 */
export type Confidence = 'low' | 'medium' | 'high';

/**
 * Why a value is absent. Preserving the reason is what lets the UI say
 * "unable to verify from public GitHub data" instead of showing a zero.
 */
export type UnknownReason =
  | 'not_retrieved'
  | 'insufficient_data'
  | 'not_applicable'
  | 'requires_elevated_permissions';

export interface Metric {
  /** Stable dotted identifier, e.g. `issues.stale.count`. */
  id: string;
  label: string;
  /** `null` means not observed — never coerce this to zero. */
  value: number | string | null;
  unit?: string;
  /** Populated whenever `value` is `null`. */
  unknownReason?: UnknownReason;
  /** Where this value came from, for the methodology disclosure. */
  source?: string;
}

export interface Finding {
  id: string;
  category: CategoryKey;
  severity: Severity;
  title: string;
  /** What was observed, and why it matters. Plain language, no jargon. */
  explanation: string;
  metric: Record<string, number | string | null>;
  recommendation: string;
  confidence: Confidence;
  evidenceUrl?: string;
}

/** One term in a category's weighted average. */
export interface ScoreComponent {
  id: string;
  label: string;
  /** Sub-score 0–100, or `null` if this component could not be evaluated. */
  score: number | null;
  weight: number;
  /** The raw observation behind the sub-score. */
  observed: string;
  /** The rule that turned the observation into a sub-score. */
  rule: string;
}

export interface ScoreExplanation {
  summary: string;
  formula: string;
  components: ScoreComponent[];
  /** What this category could not observe, and why. */
  limitations: string[];
}

export interface CategoryScore {
  key: CategoryKey;
  label: string;
  /** 0–100, or `null` when there was not enough information to score. */
  score: number | null;
  confidence: Confidence;
  metrics: Metric[];
  findings: Finding[];
  explanation: ScoreExplanation;
}

export interface OverallScore {
  score: number | null;
  confidence: Confidence;
  /** Categories that contributed, with the weight each was given. */
  contributions: Array<{
    key: CategoryKey;
    score: number;
    declaredWeight: number;
    effectiveWeight: number;
  }>;
  /** Categories excluded because they scored `null`. */
  excluded: Array<{ key: CategoryKey; reason: string }>;
  formula: string;
}

export interface AnalysisResult {
  scoringVersion: string;
  analysisId: string;
  analyzedAt: string;
  repository: RepositoryIdentity;
  overall: OverallScore;
  categories: CategoryScore[];
  /** All findings across categories, sorted by severity then category. */
  findings: Finding[];
  /** Anything that limited the analysis as a whole. */
  limitations: string[];
}

export interface RepositoryIdentity {
  /** GitHub's immutable numeric id. Survives renames and transfers. */
  githubId: number;
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  description: string | null;
  isArchived: boolean;
  isFork: boolean;
  defaultBranch: string;
}
