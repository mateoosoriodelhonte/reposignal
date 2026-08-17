import type { RepositoryIdentity } from './analysis';

/**
 * A `RepositorySnapshot` is the sole input to the scoring engine.
 *
 * It is a normalized, GitHub-agnostic view of everything RepoSignal observed
 * about a repository at one moment. Scoring functions are pure over this type,
 * which is what makes them reproducible and testable without a network.
 *
 * Every field that could not be observed is `null`. Absence is a first-class
 * state here, not something to be flattened into a default.
 */
export interface RepositorySnapshot {
  /** ISO timestamp for when this snapshot was captured. */
  capturedAt: string;
  identity: RepositoryIdentity;
  activity: ActivitySnapshot;
  pullRequests: PullRequestSnapshot | null;
  issues: IssueSnapshot | null;
  ci: CiSnapshot;
  files: FileSnapshot;
  community: CommunitySnapshot;
  /** Anything that limited data collection, e.g. a sample hitting the budget. */
  collection: CollectionReport;
}

export interface ActivitySnapshot {
  createdAt: string;
  pushedAt: string | null;
  /** Commits per week for the trailing year, oldest first. `null` if GitHub
   *  has not finished computing statistics for this repository. */
  weeklyCommits: number[] | null;
  /** Total contributors, `null` when the API declines to enumerate them. */
  contributorCount: number | null;
  releases: ReleaseRecord[];
  /** `null` when the repository has no tags. */
  tagCount: number | null;
  stars: number;
  forks: number;
  isArchived: boolean;
}

export interface ReleaseRecord {
  tagName: string;
  publishedAt: string | null;
  isPrerelease: boolean;
  htmlUrl: string;
}

export interface PullRequestSnapshot {
  openCount: number;
  /** Ages in days of open PRs in the sample, ascending. */
  openAgeDays: number[];
  /** Days from creation to merge for recently merged PRs in the sample. */
  mergedDurationDays: number[];
  /** Merged within the trailing 90 days, from the sample. */
  recentlyMergedCount: number;
  /** Closed without merging within the trailing 90 days, from the sample. */
  recentlyClosedUnmergedCount: number;
  sample: SampleReport;
}

export interface IssueSnapshot {
  /** Excludes pull requests. GitHub's issue endpoints conflate the two. */
  openCount: number;
  openAgeDays: number[];
  /** Days since last activity on each open issue in the sample. */
  openInactiveDays: number[];
  createdLast90Days: number;
  closedLast90Days: number;
  sample: SampleReport;
}

export interface CiSnapshot {
  /** `null` when the workflows endpoint could not be read. */
  workflowCount: number | null;
  workflowFileNames: string[];
  /** Conclusions of recent runs on the default branch, newest first. */
  recentRunConclusions: WorkflowConclusion[];
  /** Combined status of the newest default-branch commit, if any. */
  latestCommitStatus: 'success' | 'failure' | 'pending' | 'none' | null;
  sample: SampleReport;
}

export type WorkflowConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required'
  | 'neutral'
  | 'stale'
  | 'startup_failure'
  | 'unknown';

/**
 * Presence of repository files that indicate documented, maintained projects.
 *
 * `size` is in bytes and is `null` when the file is absent. A present-but-tiny
 * README is meaningfully different from a substantial one, and presence alone
 * would not capture that.
 */
export interface FileSnapshot {
  readme: FilePresence;
  contributing: FilePresence;
  license: FilePresence;
  security: FilePresence;
  codeOfConduct: FilePresence;
  changelog: FilePresence;
  codeowners: FilePresence;
  gitignore: FilePresence;
  issueTemplates: FilePresence;
  pullRequestTemplate: FilePresence;
  docsDirectory: FilePresence;
  /** Lockfiles found at the repository root, e.g. `package-lock.json`. */
  lockfiles: string[];
  /** Dependabot or Renovate configuration. */
  dependencyAutomation: FilePresence;
  /** Workflow files whose contents reference a security scanning action. */
  securityScanningWorkflows: string[];
}

export interface FilePresence {
  present: boolean;
  path: string | null;
  sizeBytes: number | null;
  htmlUrl: string | null;
}

export interface CommunitySnapshot {
  hasDescription: boolean;
  hasHomepage: boolean;
  topicCount: number;
  hasIssuesEnabled: boolean;
  /** `null` unless the caller has permission to read branch protection. */
  defaultBranchProtected: boolean | null;
}

/**
 * Records that a paginated collection was cut short by the request budget.
 * A truncated sample lowers the confidence of anything derived from it.
 */
export interface SampleReport {
  /** How many records were actually examined. */
  examined: number;
  /** True when more records exist than were examined. */
  truncated: boolean;
}

export interface CollectionReport {
  /** GitHub requests spent building this snapshot. */
  requestsMade: number;
  /** Endpoints that failed, keyed by a short label. */
  failures: Array<{ resource: string; reason: string }>;
  /** GitHub rate limit remaining after collection, if reported. */
  rateLimitRemaining: number | null;
}
