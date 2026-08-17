import type {
  RawContentEntry,
  RawIssue,
  RawPullRequest,
  RawRelease,
  RawRepository,
} from '@/lib/github/schemas';
import type { RepositoryIdentity } from '@/types/analysis';
import type {
  ActivitySnapshot,
  CiSnapshot,
  CommunitySnapshot,
  FilePresence,
  FileSnapshot,
  IssueSnapshot,
  PullRequestSnapshot,
  ReleaseRecord,
  SampleReport,
  WorkflowConclusion,
} from '@/types/snapshot';

import { ageInDays } from './dates';

/**
 * Normalization: GitHub payloads in, domain types out.
 *
 * This is the last layer that knows GitHub's field names. Everything below it
 * — metrics, findings, scoring, UI — works with `RepositorySnapshot` only, so
 * a GitHub API change is contained to this directory and its tests.
 *
 * Every function here is total. Unparseable or absent input becomes `null`,
 * never a default value, because a default is indistinguishable from an
 * observation once it reaches scoring.
 */

const ABSENT: FilePresence = {
  present: false,
  path: null,
  sizeBytes: null,
  htmlUrl: null,
};

/** Lockfiles RepoSignal recognizes, across the ecosystems it is likely to meet. */
const LOCKFILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'requirements.txt',
  'poetry.lock',
  'pipfile.lock',
  'uv.lock',
  'cargo.lock',
  'go.sum',
  'gemfile.lock',
  'composer.lock',
  'packages.lock.json',
  'mix.lock',
  'pubspec.lock',
  'gradle.lockfile',
]);

/**
 * Workflow steps that indicate security scanning.
 *
 * Matched as plain text against workflow file contents. Nothing is executed or
 * evaluated — RepoSignal reads workflow YAML as a string and looks for these
 * substrings, which is the full extent of its "security scanning detection".
 */
const SECURITY_SCANNERS = [
  'github/codeql-action',
  'aquasecurity/trivy-action',
  'snyk/actions',
  'returntocorp/semgrep',
  'semgrep/semgrep',
  'npm audit',
  'pnpm audit',
  'yarn audit',
  'gitleaks',
  'trufflesecurity/trufflehog',
  'dependency-review-action',
  'ossf/scorecard-action',
  'anchore/scan-action',
  'pip-audit',
  'cargo audit',
  'bundler-audit',
];

export function normalizeIdentity(raw: RawRepository): RepositoryIdentity {
  return {
    githubId: raw.id,
    owner: raw.owner.login,
    name: raw.name,
    fullName: raw.full_name,
    htmlUrl: raw.html_url,
    description: raw.description,
    isArchived: raw.archived,
    isFork: raw.fork,
    defaultBranch: raw.default_branch,
  };
}

export function normalizeReleases(raws: RawRelease[]): ReleaseRecord[] {
  return (
    raws
      // Drafts are unpublished and invisible to users, so they are not releases
      // for cadence purposes.
      .filter((raw) => !raw.draft)
      .map((raw) => ({
        tagName: raw.tag_name,
        publishedAt: raw.published_at,
        isPrerelease: raw.prerelease,
        htmlUrl: raw.html_url,
      }))
  );
}

export function normalizeActivity(input: {
  repository: RawRepository;
  releases: RawRelease[];
  weeklyCommits: number[] | null;
  contributorCount: number | null;
  tagCount: number | null;
}): ActivitySnapshot {
  return {
    createdAt: input.repository.created_at,
    pushedAt: input.repository.pushed_at,
    weeklyCommits: input.weeklyCommits,
    contributorCount: input.contributorCount,
    releases: normalizeReleases(input.releases),
    tagCount: input.tagCount,
    stars: input.repository.stargazers_count,
    forks: input.repository.forks_count,
    isArchived: input.repository.archived,
  };
}

/**
 * Removes pull requests from an issue payload.
 *
 * GitHub's `/issues` endpoints return pull requests alongside issues, and the
 * only reliable discriminator is the presence of a `pull_request` key. Failing
 * to filter here inflates every issue metric on any repository that takes
 * contributions — which is most of them.
 */
export function excludePullRequests(raws: RawIssue[]): RawIssue[] {
  return raws.filter(
    (raw) => raw.pull_request === undefined || raw.pull_request === null,
  );
}

export function normalizeIssues(input: {
  raws: RawIssue[];
  sample: SampleReport;
  hasIssuesEnabled: boolean;
  now: Date;
}): IssueSnapshot | null {
  // Issues disabled is "not applicable", not "zero issues". Returning null
  // here is what stops the category scoring as though the backlog were empty.
  if (!input.hasIssuesEnabled) return null;

  const issues = excludePullRequests(input.raws);
  const open = issues.filter((issue) => issue.state === 'open');

  const openAgeDays: number[] = [];
  const openInactiveDays: number[] = [];
  for (const issue of open) {
    const age = ageInDays(issue.created_at, input.now);
    if (age !== null) openAgeDays.push(age);

    const inactive = ageInDays(issue.updated_at, input.now);
    if (inactive !== null) openInactiveDays.push(inactive);
  }

  const createdLast90Days = issues.filter((issue) => {
    const age = ageInDays(issue.created_at, input.now);
    return age !== null && age <= 90;
  }).length;

  const closedLast90Days = issues.filter((issue) => {
    const closed = ageInDays(issue.closed_at, input.now);
    return closed !== null && closed <= 90;
  }).length;

  return {
    openCount: open.length,
    openAgeDays: openAgeDays.sort((a, b) => a - b),
    openInactiveDays: openInactiveDays.sort((a, b) => a - b),
    createdLast90Days,
    closedLast90Days,
    sample: input.sample,
  };
}

export function normalizePullRequests(input: {
  raws: RawPullRequest[];
  sample: SampleReport;
  now: Date;
}): PullRequestSnapshot | null {
  // No pull requests ever means there is nothing to assess, which is distinct
  // from a repository that merges nothing.
  if (input.raws.length === 0) return null;

  const open = input.raws.filter((pr) => pr.state === 'open');

  const openAgeDays: number[] = [];
  for (const pr of open) {
    const age = ageInDays(pr.created_at, input.now);
    if (age !== null) openAgeDays.push(age);
  }

  const mergedDurationDays: number[] = [];
  let recentlyMergedCount = 0;
  let recentlyClosedUnmergedCount = 0;

  for (const pr of input.raws) {
    const mergedAgo = ageInDays(pr.merged_at, input.now);

    if (mergedAgo !== null) {
      const opened = ageInDays(pr.created_at, input.now);
      if (opened !== null) {
        mergedDurationDays.push(Math.max(0, opened - mergedAgo));
      }
      if (mergedAgo <= 90) recentlyMergedCount += 1;
      continue;
    }

    const closedAgo = ageInDays(pr.closed_at, input.now);
    if (closedAgo !== null && closedAgo <= 90) {
      recentlyClosedUnmergedCount += 1;
    }
  }

  return {
    openCount: open.length,
    openAgeDays: openAgeDays.sort((a, b) => a - b),
    mergedDurationDays: mergedDurationDays.sort((a, b) => a - b),
    recentlyMergedCount,
    recentlyClosedUnmergedCount,
    sample: input.sample,
  };
}

const KNOWN_CONCLUSIONS = new Set<WorkflowConclusion>([
  'success',
  'failure',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'neutral',
  'stale',
  'startup_failure',
]);

export function normalizeConclusion(raw: string | null): WorkflowConclusion {
  if (raw !== null && KNOWN_CONCLUSIONS.has(raw as WorkflowConclusion)) {
    return raw as WorkflowConclusion;
  }
  return 'unknown';
}

export function normalizeCi(input: {
  workflowCount: number | null;
  workflowFileNames: string[];
  runConclusions: Array<string | null>;
  latestCommitStatus: string | null;
  sample: SampleReport;
}): CiSnapshot {
  let latest: CiSnapshot['latestCommitStatus'] = null;
  if (input.latestCommitStatus !== null) {
    switch (input.latestCommitStatus) {
      case 'success':
      case 'failure':
      case 'pending':
        latest = input.latestCommitStatus;
        break;
      default:
        // GitHub reports `state: "pending"` with `total_count: 0` for a commit
        // with no checks at all. Anything unrecognized is treated as "none"
        // rather than invented as a status.
        latest = 'none';
    }
  }

  return {
    workflowCount: input.workflowCount,
    workflowFileNames: input.workflowFileNames,
    recentRunConclusions: input.runConclusions.map(normalizeConclusion),
    latestCommitStatus: latest,
    sample: input.sample,
  };
}

/** Finds a root-level file by any of several accepted names, case-insensitively. */
export function findFile(entries: RawContentEntry[], candidates: string[]): FilePresence {
  const wanted = candidates.map((name) => name.toLowerCase());

  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    const name = entry.name.toLowerCase();

    // Matches `README`, `README.md`, `README.rst` — the stem is what matters.
    const matches = wanted.some(
      (candidate) => name === candidate || name.startsWith(`${candidate}.`),
    );

    if (matches) {
      return {
        present: true,
        path: entry.path,
        sizeBytes: entry.size,
        htmlUrl: entry.html_url,
      };
    }
  }

  return ABSENT;
}

function findDirectory(entries: RawContentEntry[], names: string[]): FilePresence {
  const wanted = names.map((name) => name.toLowerCase());

  for (const entry of entries) {
    if (entry.type !== 'dir') continue;
    if (wanted.includes(entry.name.toLowerCase())) {
      return {
        present: true,
        path: entry.path,
        sizeBytes: null,
        htmlUrl: entry.html_url,
      };
    }
  }

  return ABSENT;
}

export function detectLockfiles(entries: RawContentEntry[]): string[] {
  return entries
    .filter((entry) => entry.type === 'file' && LOCKFILES.has(entry.name.toLowerCase()))
    .map((entry) => entry.name);
}

export function detectSecurityScanners(workflowContents: string[]): string[] {
  const found = new Set<string>();

  for (const content of workflowContents) {
    const lowered = content.toLowerCase();
    for (const scanner of SECURITY_SCANNERS) {
      if (lowered.includes(scanner)) found.add(scanner);
    }
  }

  return [...found].sort();
}

export function normalizeFiles(input: {
  rootEntries: RawContentEntry[];
  githubDirEntries: RawContentEntry[];
  hasIssueTemplates: boolean;
  hasPullRequestTemplate: boolean;
  workflowContents: string[];
}): FileSnapshot {
  const root = input.rootEntries;
  const dotGithub = input.githubDirEntries;

  /** Several health files may live at the root or inside `.github/`. */
  const eitherLocation = (candidates: string[]): FilePresence => {
    const atRoot = findFile(root, candidates);
    return atRoot.present ? atRoot : findFile(dotGithub, candidates);
  };

  const dependencyAutomation = (): FilePresence => {
    const renovate = findFile(root, ['renovate', '.renovaterc']);
    if (renovate.present) return renovate;

    const renovateInGithub = findFile(dotGithub, ['renovate']);
    if (renovateInGithub.present) return renovateInGithub;

    return findFile(dotGithub, ['dependabot']);
  };

  return {
    readme: eitherLocation(['readme']),
    contributing: eitherLocation(['contributing']),
    license: eitherLocation(['license', 'licence', 'copying']),
    security: eitherLocation(['security']),
    codeOfConduct: eitherLocation(['code_of_conduct', 'code-of-conduct']),
    changelog: eitherLocation(['changelog', 'changes', 'history']),
    codeowners: eitherLocation(['codeowners']),
    gitignore: findFile(root, ['.gitignore']),
    issueTemplates: input.hasIssueTemplates
      ? { present: true, path: '.github/ISSUE_TEMPLATE', sizeBytes: null, htmlUrl: null }
      : ABSENT,
    pullRequestTemplate: input.hasPullRequestTemplate
      ? {
          present: true,
          path: '.github/pull_request_template.md',
          sizeBytes: null,
          htmlUrl: null,
        }
      : ABSENT,
    docsDirectory: findDirectory(root, ['docs', 'doc', 'documentation', 'website']),
    lockfiles: detectLockfiles(root),
    dependencyAutomation: dependencyAutomation(),
    securityScanningWorkflows: detectSecurityScanners(input.workflowContents),
  };
}

export function normalizeCommunity(input: {
  repository: RawRepository;
  defaultBranchProtected: boolean | null;
}): CommunitySnapshot {
  return {
    hasDescription:
      input.repository.description !== null && input.repository.description.trim() !== '',
    hasHomepage:
      input.repository.homepage !== null && input.repository.homepage.trim() !== '',
    topicCount: input.repository.topics.length,
    hasIssuesEnabled: input.repository.has_issues,
    defaultBranchProtected: input.defaultBranchProtected,
  };
}
