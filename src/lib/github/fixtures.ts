import type { RepositoryReference } from '@/lib/validation/repository-reference';
import type { RepositorySnapshot } from '@/types/snapshot';

/**
 * Bundled snapshots for deterministic runs.
 *
 * Enabled with `GITHUB_FIXTURES=1`. The E2E suite runs against these so CI
 * never depends on GitHub being reachable, on the rate limit, or on a real
 * repository's data staying still — a test asserting "score is 86" would
 * otherwise fail the day someone merges a pull request.
 *
 * These are *snapshots*, not invented data: the shapes match what the
 * collector produces, and they are marked as bundled wherever they surface.
 */

const CAPTURED_AT = '2026-06-01T12:00:00.000Z';

function daysAgo(days: number): string {
  return new Date(Date.parse(CAPTURED_AT) - days * 86_400_000).toISOString();
}

/** A large, healthy, actively developed project. */
const HEALTHY: RepositorySnapshot = {
  capturedAt: CAPTURED_AT,
  identity: {
    githubId: 1_000_001,
    owner: 'acme',
    name: 'toolkit',
    fullName: 'acme/toolkit',
    htmlUrl: 'https://github.com/acme/toolkit',
    description: 'A well-maintained toolkit for building things.',
    isArchived: false,
    isFork: false,
    defaultBranch: 'main',
  },
  activity: {
    createdAt: daysAgo(1500),
    pushedAt: daysAgo(1),
    weeklyCommits: Array.from({ length: 52 }, (_, index) => (index % 7 === 0 ? 0 : 12)),
    contributorCount: 148,
    releases: [
      { tagName: 'v3.1.0', publishedAt: daysAgo(15), isPrerelease: false, htmlUrl: '' },
      { tagName: 'v3.0.0', publishedAt: daysAgo(75), isPrerelease: false, htmlUrl: '' },
      { tagName: 'v2.9.0', publishedAt: daysAgo(135), isPrerelease: false, htmlUrl: '' },
      { tagName: 'v2.8.0', publishedAt: daysAgo(195), isPrerelease: false, htmlUrl: '' },
    ],
    tagCount: 42,
    stars: 8400,
    forks: 610,
    isArchived: false,
  },
  pullRequests: {
    openCount: 12,
    openAgeDays: [1, 2, 3, 5, 7, 9, 12, 16, 21, 30, 44, 61],
    mergedDurationDays: [1, 1, 2, 2, 2, 3, 3, 4, 6, 9],
    recentlyMergedCount: 68,
    recentlyClosedUnmergedCount: 9,
    sample: { examined: 120, truncated: false },
  },
  issues: {
    openCount: 34,
    openAgeDays: [3, 6, 9, 14, 20, 28, 40, 55, 70, 95, 130, 190, 260, 340],
    openInactiveDays: [1, 2, 4, 6, 9, 13, 18, 25, 40, 70, 110, 190, 240, 300],
    createdLast90Days: 46,
    closedLast90Days: 52,
    sample: { examined: 180, truncated: false },
  },
  ci: {
    workflowCount: 4,
    workflowFileNames: [
      '.github/workflows/ci.yml',
      '.github/workflows/release.yml',
      '.github/workflows/codeql.yml',
    ],
    recentRunConclusions: [
      'success',
      'success',
      'success',
      'cancelled',
      'success',
      'success',
      'failure',
      'success',
      'success',
      'skipped',
      'success',
      'success',
      'success',
      'success',
      'success',
      'success',
    ],
    latestCommitStatus: 'success',
    sample: { examined: 16, truncated: false },
  },
  files: {
    readme: {
      present: true,
      path: 'README.md',
      sizeBytes: 9200,
      htmlUrl: 'https://github.com/acme/toolkit/blob/main/README.md',
    },
    contributing: {
      present: true,
      path: 'CONTRIBUTING.md',
      sizeBytes: 3400,
      htmlUrl: null,
    },
    license: { present: true, path: 'LICENSE', sizeBytes: 1100, htmlUrl: null },
    security: { present: true, path: 'SECURITY.md', sizeBytes: 800, htmlUrl: null },
    codeOfConduct: {
      present: true,
      path: 'CODE_OF_CONDUCT.md',
      sizeBytes: 5200,
      htmlUrl: null,
    },
    changelog: { present: true, path: 'CHANGELOG.md', sizeBytes: 14000, htmlUrl: null },
    codeowners: {
      present: true,
      path: '.github/CODEOWNERS',
      sizeBytes: 210,
      htmlUrl: null,
    },
    gitignore: { present: true, path: '.gitignore', sizeBytes: 480, htmlUrl: null },
    issueTemplates: {
      present: true,
      path: '.github/ISSUE_TEMPLATE',
      sizeBytes: null,
      htmlUrl: null,
    },
    pullRequestTemplate: {
      present: true,
      path: '.github/pull_request_template.md',
      sizeBytes: null,
      htmlUrl: null,
    },
    docsDirectory: { present: true, path: 'docs', sizeBytes: null, htmlUrl: null },
    lockfiles: ['package-lock.json'],
    dependencyAutomation: {
      present: true,
      path: '.github/dependabot.yml',
      sizeBytes: 420,
      htmlUrl: null,
    },
    securityScanningWorkflows: ['github/codeql-action'],
  },
  community: {
    hasDescription: true,
    hasHomepage: true,
    topicCount: 6,
    hasIssuesEnabled: true,
    // Unreadable, as it is for almost every public repository.
    defaultBranchProtected: null,
  },
  collection: { requestsMade: 22, failures: [], rateLimitRemaining: 4870 },
};

/**
 * A repository with several categories unscorable: issues disabled, no pull
 * requests, and CI unreadable. Exercises the partial-data path end to end.
 */
const SPARSE: RepositorySnapshot = {
  capturedAt: CAPTURED_AT,
  identity: {
    githubId: 1_000_002,
    owner: 'acme',
    name: 'sparse',
    fullName: 'acme/sparse',
    htmlUrl: 'https://github.com/acme/sparse',
    description: null,
    isArchived: false,
    isFork: false,
    defaultBranch: 'main',
  },
  activity: {
    createdAt: daysAgo(900),
    pushedAt: daysAgo(400),
    // GitHub had not computed statistics for this repository.
    weeklyCommits: null,
    contributorCount: null,
    releases: [],
    tagCount: 0,
    stars: 12,
    forks: 1,
    isArchived: false,
  },
  pullRequests: null,
  issues: null,
  ci: {
    workflowCount: null,
    workflowFileNames: [],
    recentRunConclusions: [],
    latestCommitStatus: null,
    sample: { examined: 0, truncated: false },
  },
  files: {
    readme: { present: true, path: 'README.md', sizeBytes: 140, htmlUrl: null },
    contributing: { present: false, path: null, sizeBytes: null, htmlUrl: null },
    license: { present: false, path: null, sizeBytes: null, htmlUrl: null },
    security: { present: false, path: null, sizeBytes: null, htmlUrl: null },
    codeOfConduct: { present: false, path: null, sizeBytes: null, htmlUrl: null },
    changelog: { present: false, path: null, sizeBytes: null, htmlUrl: null },
    codeowners: { present: false, path: null, sizeBytes: null, htmlUrl: null },
    gitignore: { present: true, path: '.gitignore', sizeBytes: 60, htmlUrl: null },
    issueTemplates: { present: false, path: null, sizeBytes: null, htmlUrl: null },
    pullRequestTemplate: { present: false, path: null, sizeBytes: null, htmlUrl: null },
    docsDirectory: { present: false, path: null, sizeBytes: null, htmlUrl: null },
    lockfiles: [],
    dependencyAutomation: { present: false, path: null, sizeBytes: null, htmlUrl: null },
    securityScanningWorkflows: [],
  },
  community: {
    hasDescription: false,
    hasHomepage: false,
    topicCount: 0,
    hasIssuesEnabled: false,
    defaultBranchProtected: null,
  },
  collection: {
    requestsMade: 14,
    failures: [
      { resource: 'actions/workflows', reason: 'forbidden' },
      { resource: 'branch protection', reason: 'forbidden' },
    ],
    rateLimitRemaining: 4900,
  },
};

const FIXTURES = new Map<string, RepositorySnapshot>([
  ['acme/toolkit', HEALTHY],
  ['acme/sparse', SPARSE],
]);

/** True when the application should serve bundled fixtures. */
export function usingFixtures(): boolean {
  return process.env.GITHUB_FIXTURES === '1';
}

/**
 * Returns a bundled snapshot, re-stamped to the supplied time.
 *
 * Restamping keeps ages stable relative to `now`, so a fixture recorded once
 * does not slowly drift into "no push in over a year" as real time passes.
 */
export function fixtureSnapshot(
  reference: RepositoryReference,
  now: Date,
): RepositorySnapshot | null {
  const key = `${reference.owner}/${reference.name}`.toLowerCase();
  const fixture = FIXTURES.get(key);
  if (fixture === undefined) return null;

  const offsetMs = now.getTime() - Date.parse(CAPTURED_AT);
  const shift = (iso: string | null): string | null =>
    iso === null ? null : new Date(Date.parse(iso) + offsetMs).toISOString();

  return {
    ...fixture,
    capturedAt: now.toISOString(),
    activity: {
      ...fixture.activity,
      createdAt: shift(fixture.activity.createdAt) ?? fixture.activity.createdAt,
      pushedAt: shift(fixture.activity.pushedAt),
      releases: fixture.activity.releases.map((release) => ({
        ...release,
        publishedAt: shift(release.publishedAt),
      })),
    },
  };
}

/** The fixture repositories, for the examples shown in fixture mode. */
export const FIXTURE_NAMES = [...FIXTURES.keys()];
