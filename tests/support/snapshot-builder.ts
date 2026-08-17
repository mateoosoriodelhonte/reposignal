import type {
  ActivitySnapshot,
  CiSnapshot,
  CommunitySnapshot,
  FilePresence,
  FileSnapshot,
  IssueSnapshot,
  PullRequestSnapshot,
  RepositorySnapshot,
} from '@/types/snapshot';

/**
 * Builds `RepositorySnapshot` values for scoring tests.
 *
 * Scoring is pure over this type, so tests construct plain objects rather than
 * recorded HTTP fixtures. That is the practical payoff of the normalization
 * boundary: a test for "median PR age at exactly 90 days" is three lines, not
 * a curated JSON file.
 */

/** The fixed clock every scoring test uses. */
export const NOW = new Date('2026-06-01T00:00:00Z');

export function daysAgo(days: number, from: Date = NOW): string {
  return new Date(from.getTime() - days * 86_400_000).toISOString();
}

export function present(overrides: Partial<FilePresence> = {}): FilePresence {
  return {
    present: true,
    path: 'README.md',
    sizeBytes: 5000,
    htmlUrl: 'https://github.com/acme/widget/blob/main/README.md',
    ...overrides,
  };
}

export const ABSENT: FilePresence = {
  present: false,
  path: null,
  sizeBytes: null,
  htmlUrl: null,
};

function defaultFiles(): FileSnapshot {
  return {
    readme: ABSENT,
    contributing: ABSENT,
    license: ABSENT,
    security: ABSENT,
    codeOfConduct: ABSENT,
    changelog: ABSENT,
    codeowners: ABSENT,
    gitignore: ABSENT,
    issueTemplates: ABSENT,
    pullRequestTemplate: ABSENT,
    docsDirectory: ABSENT,
    lockfiles: [],
    dependencyAutomation: ABSENT,
    securityScanningWorkflows: [],
  };
}

/** Every documentation and hygiene file present, for "healthy project" cases. */
export function allFilesPresent(): FileSnapshot {
  return {
    readme: present({ path: 'README.md', sizeBytes: 8000 }),
    contributing: present({ path: 'CONTRIBUTING.md', sizeBytes: 3000 }),
    license: present({ path: 'LICENSE', sizeBytes: 1000 }),
    security: present({ path: 'SECURITY.md', sizeBytes: 900 }),
    codeOfConduct: present({ path: 'CODE_OF_CONDUCT.md', sizeBytes: 3000 }),
    changelog: present({ path: 'CHANGELOG.md', sizeBytes: 2000 }),
    codeowners: present({ path: '.github/CODEOWNERS', sizeBytes: 100 }),
    gitignore: present({ path: '.gitignore', sizeBytes: 400 }),
    issueTemplates: present({ path: '.github/ISSUE_TEMPLATE', sizeBytes: null }),
    pullRequestTemplate: present({
      path: '.github/pull_request_template.md',
      sizeBytes: null,
    }),
    docsDirectory: present({ path: 'docs', sizeBytes: null }),
    lockfiles: ['package-lock.json'],
    dependencyAutomation: present({ path: '.github/dependabot.yml', sizeBytes: 300 }),
    securityScanningWorkflows: ['github/codeql-action'],
  };
}

function defaultActivity(): ActivitySnapshot {
  return {
    createdAt: daysAgo(1000),
    pushedAt: daysAgo(3),
    weeklyCommits: Array.from({ length: 52 }, () => 5),
    contributorCount: 20,
    releases: [
      { tagName: 'v1.0.0', publishedAt: daysAgo(200), isPrerelease: false, htmlUrl: '' },
      { tagName: 'v1.1.0', publishedAt: daysAgo(140), isPrerelease: false, htmlUrl: '' },
      { tagName: 'v1.2.0', publishedAt: daysAgo(80), isPrerelease: false, htmlUrl: '' },
      { tagName: 'v1.3.0', publishedAt: daysAgo(20), isPrerelease: false, htmlUrl: '' },
    ],
    tagCount: 4,
    stars: 1200,
    forks: 90,
    isArchived: false,
  };
}

function defaultIssues(): IssueSnapshot {
  return {
    openCount: 10,
    openAgeDays: [5, 10, 20, 30, 40, 50, 60, 70, 80, 90],
    openInactiveDays: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    createdLast90Days: 20,
    closedLast90Days: 22,
    sample: { examined: 30, truncated: false },
  };
}

function defaultPullRequests(): PullRequestSnapshot {
  return {
    openCount: 5,
    openAgeDays: [1, 3, 5, 8, 12],
    mergedDurationDays: [1, 1, 2, 2, 3, 4],
    recentlyMergedCount: 25,
    recentlyClosedUnmergedCount: 3,
    sample: { examined: 40, truncated: false },
  };
}

function defaultCi(): CiSnapshot {
  return {
    workflowCount: 2,
    workflowFileNames: ['.github/workflows/ci.yml'],
    recentRunConclusions: Array.from({ length: 20 }, () => 'success' as const),
    latestCommitStatus: 'success',
    sample: { examined: 20, truncated: false },
  };
}

function defaultCommunity(): CommunitySnapshot {
  return {
    hasDescription: true,
    hasHomepage: true,
    topicCount: 5,
    hasIssuesEnabled: true,
    defaultBranchProtected: null,
  };
}

export interface SnapshotOverrides {
  activity?: Partial<ActivitySnapshot>;
  issues?: Partial<IssueSnapshot> | null;
  pullRequests?: Partial<PullRequestSnapshot> | null;
  ci?: Partial<CiSnapshot>;
  files?: Partial<FileSnapshot>;
  community?: Partial<CommunitySnapshot>;
  identity?: Partial<RepositorySnapshot['identity']>;
  collection?: Partial<RepositorySnapshot['collection']>;
}

/**
 * A snapshot of a healthy repository, with everything present and recent.
 * Tests override only the field under examination.
 */
export function buildSnapshot(overrides: SnapshotOverrides = {}): RepositorySnapshot {
  return {
    capturedAt: NOW.toISOString(),
    identity: {
      githubId: 1,
      owner: 'acme',
      name: 'widget',
      fullName: 'acme/widget',
      htmlUrl: 'https://github.com/acme/widget',
      description: 'A widget',
      isArchived: overrides.activity?.isArchived ?? false,
      isFork: false,
      defaultBranch: 'main',
      ...overrides.identity,
    },
    activity: { ...defaultActivity(), ...overrides.activity },
    issues:
      overrides.issues === null ? null : { ...defaultIssues(), ...overrides.issues },
    pullRequests:
      overrides.pullRequests === null
        ? null
        : { ...defaultPullRequests(), ...overrides.pullRequests },
    ci: { ...defaultCi(), ...overrides.ci },
    files: { ...defaultFiles(), ...overrides.files },
    community: { ...defaultCommunity(), ...overrides.community },
    collection: {
      requestsMade: 12,
      failures: [],
      rateLimitRemaining: 4900,
      ...overrides.collection,
    },
  };
}

/** A snapshot with every observable signal in its best state. */
export function buildHealthySnapshot(
  overrides: SnapshotOverrides = {},
): RepositorySnapshot {
  return buildSnapshot({
    ...overrides,
    files: { ...allFilesPresent(), ...overrides.files },
  });
}
