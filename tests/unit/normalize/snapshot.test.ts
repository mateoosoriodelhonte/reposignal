import { describe, expect, it } from 'vitest';

import type {
  RawContentEntry,
  RawIssue,
  RawPullRequest,
  RawRelease,
  RawRepository,
} from '@/lib/github/schemas';
import {
  detectLockfiles,
  detectSecurityScanners,
  excludePullRequests,
  findFile,
  normalizeCi,
  normalizeCommunity,
  normalizeConclusion,
  normalizeFiles,
  normalizeIdentity,
  normalizeIssues,
  normalizePullRequests,
  normalizeReleases,
} from '@/lib/normalize/snapshot';
import type { SampleReport } from '@/types/snapshot';

const NOW = new Date('2026-06-01T00:00:00Z');
const COMPLETE: SampleReport = { examined: 10, truncated: false };

/** Days before NOW, as an ISO string. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function repository(overrides: Partial<RawRepository> = {}): RawRepository {
  return {
    id: 10270250,
    name: 'react',
    full_name: 'facebook/react',
    owner: { login: 'facebook' },
    html_url: 'https://github.com/facebook/react',
    description: 'A JavaScript library for building user interfaces',
    created_at: '2013-05-24T16:15:54Z',
    pushed_at: daysAgo(1),
    default_branch: 'main',
    archived: false,
    fork: false,
    stargazers_count: 220_000,
    forks_count: 45_000,
    open_issues_count: 900,
    has_issues: true,
    homepage: 'https://react.dev',
    topics: ['javascript', 'react'],
    license: { spdx_id: 'MIT' },
    ...overrides,
  } as RawRepository;
}

function issue(overrides: Partial<RawIssue> = {}): RawIssue {
  return {
    number: 1,
    state: 'open',
    created_at: daysAgo(10),
    updated_at: daysAgo(5),
    closed_at: null,
    html_url: 'https://github.com/facebook/react/issues/1',
    ...overrides,
  } as RawIssue;
}

function pull(overrides: Partial<RawPullRequest> = {}): RawPullRequest {
  return {
    number: 1,
    state: 'open',
    created_at: daysAgo(10),
    updated_at: daysAgo(5),
    closed_at: null,
    merged_at: null,
    draft: false,
    html_url: 'https://github.com/facebook/react/pull/1',
    ...overrides,
  } as RawPullRequest;
}

function file(name: string, size = 1000, type = 'file'): RawContentEntry {
  return {
    name,
    path: name,
    type,
    size,
    html_url: `https://github.com/facebook/react/blob/main/${name}`,
  };
}

describe('normalizeIdentity', () => {
  it('keys identity on the immutable numeric id', () => {
    const identity = normalizeIdentity(repository());
    expect(identity.githubId).toBe(10270250);
    expect(identity.fullName).toBe('facebook/react');
    expect(identity.defaultBranch).toBe('main');
  });

  it('preserves a null description rather than substituting a string', () => {
    expect(normalizeIdentity(repository({ description: null })).description).toBeNull();
  });
});

describe('excludePullRequests — the issues/PRs regression', () => {
  it('removes any payload carrying a pull_request key', () => {
    // GitHub's /issues endpoints return PRs alongside issues. Failing to
    // filter inflates every issue metric on any repository taking
    // contributions, which is most of them.
    const mixed: RawIssue[] = [
      issue({ number: 1 }),
      issue({ number: 2, pull_request: { url: 'https://api.github.com/…' } }),
      issue({ number: 3 }),
      issue({ number: 4, pull_request: {} }),
    ];

    const result = excludePullRequests(mixed);
    expect(result.map((i) => i.number)).toEqual([1, 3]);
  });

  it('keeps issues whose pull_request key is explicitly null', () => {
    const raws = [issue({ number: 1, pull_request: null })];
    expect(excludePullRequests(raws)).toHaveLength(1);
  });

  it('does not affect a list containing no pull requests', () => {
    const raws = [issue({ number: 1 }), issue({ number: 2 })];
    expect(excludePullRequests(raws)).toHaveLength(2);
  });
});

describe('normalizeIssues', () => {
  it('returns null when issues are disabled, not a zero backlog', () => {
    // This is the difference between "not applicable" and "no issues", and
    // the whole reason the field is nullable.
    const result = normalizeIssues({
      raws: [],
      sample: COMPLETE,
      hasIssuesEnabled: false,
      now: NOW,
    });
    expect(result).toBeNull();
  });

  it('returns a zero-count snapshot when issues are enabled but empty', () => {
    const result = normalizeIssues({
      raws: [],
      sample: COMPLETE,
      hasIssuesEnabled: true,
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result?.openCount).toBe(0);
  });

  it('excludes pull requests from the open count', () => {
    const result = normalizeIssues({
      raws: [issue({ number: 1 }), issue({ number: 2, pull_request: {} })],
      sample: COMPLETE,
      hasIssuesEnabled: true,
      now: NOW,
    });
    expect(result?.openCount).toBe(1);
  });

  it('sorts age and inactivity ascending', () => {
    const result = normalizeIssues({
      raws: [
        issue({ number: 1, created_at: daysAgo(300), updated_at: daysAgo(200) }),
        issue({ number: 2, created_at: daysAgo(10), updated_at: daysAgo(2) }),
        issue({ number: 3, created_at: daysAgo(100), updated_at: daysAgo(50) }),
      ],
      sample: COMPLETE,
      hasIssuesEnabled: true,
      now: NOW,
    });
    expect(result?.openAgeDays).toEqual([10, 100, 300]);
    expect(result?.openInactiveDays).toEqual([2, 50, 200]);
  });

  it('counts creations and closures within the trailing 90 days', () => {
    const result = normalizeIssues({
      raws: [
        issue({ number: 1, created_at: daysAgo(30) }),
        issue({ number: 2, created_at: daysAgo(200) }),
        issue({
          number: 3,
          state: 'closed',
          created_at: daysAgo(120),
          closed_at: daysAgo(10),
        }),
        issue({
          number: 4,
          state: 'closed',
          created_at: daysAgo(400),
          closed_at: daysAgo(300),
        }),
      ],
      sample: COMPLETE,
      hasIssuesEnabled: true,
      now: NOW,
    });
    expect(result?.createdLast90Days).toBe(1);
    expect(result?.closedLast90Days).toBe(1);
  });

  it('carries the sample report through so confidence can be lowered', () => {
    const truncated: SampleReport = { examined: 200, truncated: true };
    const result = normalizeIssues({
      raws: [issue()],
      sample: truncated,
      hasIssuesEnabled: true,
      now: NOW,
    });
    expect(result?.sample.truncated).toBe(true);
  });

  it('skips issues whose timestamps are unparseable rather than counting them as zero-age', () => {
    const result = normalizeIssues({
      raws: [issue({ number: 1, created_at: 'not-a-date', updated_at: 'nope' })],
      sample: COMPLETE,
      hasIssuesEnabled: true,
      now: NOW,
    });
    expect(result?.openCount).toBe(1);
    expect(result?.openAgeDays).toEqual([]);
  });
});

describe('normalizePullRequests', () => {
  it('returns null when the repository has never had a pull request', () => {
    expect(normalizePullRequests({ raws: [], sample: COMPLETE, now: NOW })).toBeNull();
  });

  it('computes merge duration from creation to merge', () => {
    const result = normalizePullRequests({
      raws: [pull({ created_at: daysAgo(20), merged_at: daysAgo(15), state: 'closed' })],
      sample: COMPLETE,
      now: NOW,
    });
    expect(result?.mergedDurationDays).toEqual([5]);
  });

  it('separates recently merged from recently closed-unmerged', () => {
    const result = normalizePullRequests({
      raws: [
        pull({
          number: 1,
          created_at: daysAgo(40),
          merged_at: daysAgo(30),
          state: 'closed',
        }),
        pull({
          number: 2,
          created_at: daysAgo(40),
          closed_at: daysAgo(30),
          state: 'closed',
        }),
        pull({
          number: 3,
          created_at: daysAgo(400),
          merged_at: daysAgo(300),
          state: 'closed',
        }),
      ],
      sample: COMPLETE,
      now: NOW,
    });
    expect(result?.recentlyMergedCount).toBe(1);
    expect(result?.recentlyClosedUnmergedCount).toBe(1);
  });

  it('counts only open PRs in the open count and age distribution', () => {
    const result = normalizePullRequests({
      raws: [
        pull({ number: 1, state: 'open', created_at: daysAgo(5) }),
        pull({
          number: 2,
          state: 'closed',
          merged_at: daysAgo(1),
          created_at: daysAgo(3),
        }),
      ],
      sample: COMPLETE,
      now: NOW,
    });
    expect(result?.openCount).toBe(1);
    expect(result?.openAgeDays).toEqual([5]);
  });

  it('never produces a negative merge duration from skewed timestamps', () => {
    const result = normalizePullRequests({
      raws: [pull({ created_at: daysAgo(5), merged_at: daysAgo(10), state: 'closed' })],
      sample: COMPLETE,
      now: NOW,
    });
    expect(result?.mergedDurationDays.every((d) => d >= 0)).toBe(true);
  });
});

describe('normalizeReleases', () => {
  const release = (overrides: Partial<RawRelease> = {}): RawRelease =>
    ({
      tag_name: 'v1.0.0',
      published_at: daysAgo(30),
      prerelease: false,
      draft: false,
      html_url: 'https://github.com/facebook/react/releases/tag/v1.0.0',
      ...overrides,
    }) as RawRelease;

  it('excludes drafts, which are invisible to users', () => {
    const result = normalizeReleases([
      release({ tag_name: 'v1.0.0' }),
      release({ tag_name: 'v2.0.0-draft', draft: true }),
    ]);
    expect(result.map((r) => r.tagName)).toEqual(['v1.0.0']);
  });

  it('keeps prereleases but marks them', () => {
    const result = normalizeReleases([
      release({ tag_name: 'v2.0.0-rc.1', prerelease: true }),
    ]);
    expect(result[0]?.isPrerelease).toBe(true);
  });
});

describe('normalizeConclusion', () => {
  it.each([
    ['success', 'success'],
    ['failure', 'failure'],
    ['cancelled', 'cancelled'],
    ['skipped', 'skipped'],
    ['timed_out', 'timed_out'],
  ])('passes through the known conclusion %s', (input, expected) => {
    expect(normalizeConclusion(input)).toBe(expected);
  });

  it.each([
    ['null, meaning still running', null],
    ['an unrecognized value', 'some_new_conclusion_github_added'],
  ])('maps %s to unknown rather than guessing', (_label, input) => {
    expect(normalizeConclusion(input)).toBe('unknown');
  });
});

describe('normalizeCi', () => {
  it('preserves a null workflow count as unknown, not as zero workflows', () => {
    // The distinction that matters most in this category: unreadable CI data
    // is not the same as a repository with no CI.
    const result = normalizeCi({
      workflowCount: null,
      workflowFileNames: [],
      runConclusions: [],
      latestCommitStatus: null,
      sample: COMPLETE,
    });
    expect(result.workflowCount).toBeNull();
  });

  it('records zero workflows distinctly from unknown', () => {
    const result = normalizeCi({
      workflowCount: 0,
      workflowFileNames: [],
      runConclusions: [],
      latestCommitStatus: null,
      sample: COMPLETE,
    });
    expect(result.workflowCount).toBe(0);
  });

  it.each([
    ['success', 'success'],
    ['failure', 'failure'],
    ['pending', 'pending'],
  ])('passes through commit status %s', (input, expected) => {
    const result = normalizeCi({
      workflowCount: 1,
      workflowFileNames: ['ci.yml'],
      runConclusions: [],
      latestCommitStatus: input,
      sample: COMPLETE,
    });
    expect(result.latestCommitStatus).toBe(expected);
  });

  it('maps an unrecognized commit status to none rather than inventing one', () => {
    const result = normalizeCi({
      workflowCount: 1,
      workflowFileNames: [],
      runConclusions: [],
      latestCommitStatus: 'something_else',
      sample: COMPLETE,
    });
    expect(result.latestCommitStatus).toBe('none');
  });
});

describe('findFile', () => {
  const entries = [
    file('README.md'),
    file('LICENSE'),
    file('src', 0, 'dir'),
    file('package.json'),
  ];

  it('matches case-insensitively', () => {
    expect(findFile(entries, ['readme']).present).toBe(true);
  });

  it('matches a stem with any extension', () => {
    expect(findFile([file('CONTRIBUTING.rst')], ['contributing']).present).toBe(true);
  });

  it('matches an extensionless file', () => {
    expect(findFile(entries, ['license']).present).toBe(true);
  });

  it('accepts any of several spellings', () => {
    expect(findFile([file('LICENCE.txt')], ['license', 'licence']).present).toBe(true);
  });

  it('does not match a directory of the same name', () => {
    expect(findFile([file('docs', 0, 'dir')], ['docs']).present).toBe(false);
  });

  it('reports absence with nulls rather than zeros', () => {
    const result = findFile(entries, ['security']);
    expect(result).toEqual({
      present: false,
      path: null,
      sizeBytes: null,
      htmlUrl: null,
    });
  });

  it('captures size so a stub can be told from a substantial file', () => {
    expect(findFile([file('README.md', 42)], ['readme']).sizeBytes).toBe(42);
  });
});

describe('detectLockfiles', () => {
  it.each([
    ['npm', 'package-lock.json'],
    ['yarn', 'yarn.lock'],
    ['pnpm', 'pnpm-lock.yaml'],
    ['bun', 'bun.lockb'],
    ['poetry', 'poetry.lock'],
    ['cargo', 'Cargo.lock'],
    ['go', 'go.sum'],
    ['bundler', 'Gemfile.lock'],
    ['composer', 'composer.lock'],
  ])('detects the %s lockfile', (_label, name) => {
    expect(detectLockfiles([file(name)])).toEqual([name]);
  });

  it('ignores non-lockfiles', () => {
    expect(detectLockfiles([file('package.json'), file('README.md')])).toEqual([]);
  });

  it('ignores a directory that shares a lockfile name', () => {
    expect(detectLockfiles([file('go.sum', 0, 'dir')])).toEqual([]);
  });
});

describe('detectSecurityScanners', () => {
  it.each([
    ['CodeQL', 'uses: github/codeql-action/analyze@v3'],
    ['Trivy', 'uses: aquasecurity/trivy-action@master'],
    ['Snyk', 'uses: snyk/actions/node@master'],
    ['Semgrep', 'uses: semgrep/semgrep-action@v1'],
    ['npm audit', 'run: npm audit --audit-level=high'],
    ['gitleaks', 'uses: gitleaks/gitleaks-action@v2'],
  ])('detects %s in workflow text', (_label, content) => {
    expect(detectSecurityScanners([content]).length).toBeGreaterThan(0);
  });

  it('finds nothing in a workflow without scanning', () => {
    expect(detectSecurityScanners(['run: npm test'])).toEqual([]);
  });

  it('deduplicates a scanner used across several workflows', () => {
    const result = detectSecurityScanners([
      'uses: github/codeql-action/init@v3',
      'uses: github/codeql-action/analyze@v3',
    ]);
    expect(result).toEqual(['github/codeql-action']);
  });

  it('handles an empty workflow list', () => {
    expect(detectSecurityScanners([])).toEqual([]);
  });
});

describe('normalizeFiles', () => {
  const base = {
    rootEntries: [],
    githubDirEntries: [],
    hasIssueTemplates: false,
    hasPullRequestTemplate: false,
    workflowContents: [],
  };

  it('finds health files at the repository root', () => {
    const result = normalizeFiles({
      ...base,
      rootEntries: [file('README.md'), file('LICENSE'), file('CONTRIBUTING.md')],
    });
    expect(result.readme.present).toBe(true);
    expect(result.license.present).toBe(true);
    expect(result.contributing.present).toBe(true);
  });

  it('also finds health files inside .github', () => {
    // GitHub honours both locations, so checking only the root would report a
    // documented project as undocumented.
    const result = normalizeFiles({
      ...base,
      githubDirEntries: [file('CONTRIBUTING.md'), file('SECURITY.md')],
    });
    expect(result.contributing.present).toBe(true);
    expect(result.security.present).toBe(true);
  });

  it('prefers the root copy when a file exists in both locations', () => {
    const result = normalizeFiles({
      ...base,
      rootEntries: [file('CONTRIBUTING.md', 5000)],
      githubDirEntries: [file('CONTRIBUTING.md', 100)],
    });
    expect(result.contributing.sizeBytes).toBe(5000);
  });

  it.each([
    ['dependabot', { githubDirEntries: [file('dependabot.yml')] }],
    ['renovate at the root', { rootEntries: [file('renovate.json')] }],
    ['renovate in .github', { githubDirEntries: [file('renovate.json')] }],
    ['a dotfile renovate config', { rootEntries: [file('.renovaterc.json')] }],
  ])('detects dependency automation via %s', (_label, overrides) => {
    const result = normalizeFiles({ ...base, ...overrides });
    expect(result.dependencyAutomation.present).toBe(true);
  });

  it('finds a docs directory but not a docs file', () => {
    expect(
      normalizeFiles({ ...base, rootEntries: [file('docs', 0, 'dir')] }).docsDirectory
        .present,
    ).toBe(true);
    expect(
      normalizeFiles({ ...base, rootEntries: [file('docs.md')] }).docsDirectory.present,
    ).toBe(false);
  });

  it('reports every file absent for an empty repository', () => {
    const result = normalizeFiles(base);
    expect(result.readme.present).toBe(false);
    expect(result.license.present).toBe(false);
    expect(result.lockfiles).toEqual([]);
    expect(result.securityScanningWorkflows).toEqual([]);
  });
});

describe('normalizeCommunity', () => {
  it('treats a whitespace-only description as absent', () => {
    const result = normalizeCommunity({
      repository: repository({ description: '   ' }),
      defaultBranchProtected: null,
    });
    expect(result.hasDescription).toBe(false);
  });

  it('preserves unreadable branch protection as null, not false', () => {
    // Branch protection needs elevated permissions on most repositories.
    // Reporting "unknown" as "not protected" would penalize a repository for
    // a permission RepoSignal does not have.
    const result = normalizeCommunity({
      repository: repository(),
      defaultBranchProtected: null,
    });
    expect(result.defaultBranchProtected).toBeNull();
  });

  it('records protection when it is actually readable', () => {
    const result = normalizeCommunity({
      repository: repository(),
      defaultBranchProtected: true,
    });
    expect(result.defaultBranchProtected).toBe(true);
  });
});
