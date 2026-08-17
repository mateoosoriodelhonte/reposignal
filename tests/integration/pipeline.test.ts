import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AnalysisService } from '@/lib/analysis/service';
import { GitHubClient } from '@/lib/github/client';
import { collectSnapshot } from '@/lib/github/collector';
import { RequestBudget } from '@/lib/github/request-budget';
import { createLogger } from '@/lib/logging/logger';
import { analyzeSnapshot } from '@/lib/scoring';
import { MemoryAnalysisStore } from '@/lib/store/memory-store';

/**
 * Integration tests: GitHub responses → normalization → metrics → findings →
 * scoring → `AnalysisResult`.
 *
 * The unit tests prove each layer works alone. These prove the layers compose,
 * which is where boundary mismatches actually appear.
 *
 * MSW intercepts every request and `onUnhandledRequest: 'error'` means any
 * request this suite does not explicitly describe fails the test rather than
 * escaping to the real API.
 */

const API = 'https://api.github.com';
const NOW = new Date('2026-06-01T00:00:00Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

interface RepoOptions {
  id?: number;
  fullName?: string;
  archived?: boolean;
  hasIssues?: boolean;
  pushedAt?: string | null;
}

function repositoryPayload(options: RepoOptions = {}) {
  const fullName = options.fullName ?? 'acme/toolkit';
  const [owner = 'acme', name = 'toolkit'] = fullName.split('/');

  return {
    id: options.id ?? 555,
    name,
    full_name: fullName,
    owner: { login: owner },
    html_url: `https://github.com/${fullName}`,
    description: 'A toolkit',
    created_at: daysAgo(1200),
    pushed_at: options.pushedAt === undefined ? daysAgo(2) : options.pushedAt,
    default_branch: 'main',
    archived: options.archived ?? false,
    fork: false,
    stargazers_count: 900,
    forks_count: 80,
    open_issues_count: 12,
    has_issues: options.hasIssues ?? true,
    homepage: 'https://acme.example',
    topics: ['tools', 'cli', 'node'],
    license: { spdx_id: 'MIT' },
  };
}

/**
 * Describes a complete, healthy repository. Individual tests override single
 * endpoints on top of this to isolate the behaviour under test.
 */
function healthyHandlers(options: RepoOptions = {}) {
  const base = `${API}/repos/${options.fullName ?? 'acme/toolkit'}`;

  return [
    http.get(base, () => HttpResponse.json(repositoryPayload(options))),

    http.get(`${base}/contents`, () =>
      HttpResponse.json([
        {
          name: 'README.md',
          path: 'README.md',
          type: 'file',
          size: 8000,
          html_url: null,
        },
        { name: 'LICENSE', path: 'LICENSE', type: 'file', size: 1000, html_url: null },
        {
          name: 'CONTRIBUTING.md',
          path: 'CONTRIBUTING.md',
          type: 'file',
          size: 2000,
          html_url: null,
        },
        {
          name: 'package-lock.json',
          path: 'package-lock.json',
          type: 'file',
          size: 90000,
          html_url: null,
        },
        {
          name: '.gitignore',
          path: '.gitignore',
          type: 'file',
          size: 300,
          html_url: null,
        },
        { name: 'docs', path: 'docs', type: 'dir', size: 0, html_url: null },
      ]),
    ),

    http.get(`${base}/contents/.github`, () =>
      HttpResponse.json([
        {
          name: 'ISSUE_TEMPLATE',
          path: '.github/ISSUE_TEMPLATE',
          type: 'dir',
          size: 0,
          html_url: null,
        },
        {
          name: 'pull_request_template.md',
          path: '.github/pull_request_template.md',
          type: 'file',
          size: 400,
          html_url: null,
        },
        {
          name: 'dependabot.yml',
          path: '.github/dependabot.yml',
          type: 'file',
          size: 300,
          html_url: null,
        },
        {
          name: 'CODEOWNERS',
          path: '.github/CODEOWNERS',
          type: 'file',
          size: 100,
          html_url: null,
        },
        {
          name: 'SECURITY.md',
          path: '.github/SECURITY.md',
          type: 'file',
          size: 700,
          html_url: null,
        },
        {
          name: 'CODE_OF_CONDUCT.md',
          path: '.github/CODE_OF_CONDUCT.md',
          type: 'file',
          size: 4000,
          html_url: null,
        },
      ]),
    ),

    http.get(`${base}/contents/.github/workflows`, () =>
      HttpResponse.json([
        {
          name: 'ci.yml',
          path: '.github/workflows/ci.yml',
          type: 'file',
          size: 900,
          html_url: null,
        },
      ]),
    ),

    http.get(`${base}/contents/.github/workflows/ci.yml`, () =>
      HttpResponse.text('jobs:\n  scan:\n    uses: github/codeql-action/analyze@v3'),
    ),

    http.get(`${base}/issues`, () =>
      HttpResponse.json([
        {
          number: 1,
          state: 'open',
          created_at: daysAgo(20),
          updated_at: daysAgo(3),
          closed_at: null,
          html_url: `https://github.com/${options.fullName ?? 'acme/toolkit'}/issues/1`,
        },
        {
          number: 2,
          state: 'closed',
          created_at: daysAgo(60),
          updated_at: daysAgo(10),
          closed_at: daysAgo(10),
          html_url: `https://github.com/${options.fullName ?? 'acme/toolkit'}/issues/2`,
        },
        {
          // A pull request, returned by the issues endpoint as GitHub does.
          number: 3,
          state: 'open',
          created_at: daysAgo(5),
          updated_at: daysAgo(1),
          closed_at: null,
          html_url: `https://github.com/${options.fullName ?? 'acme/toolkit'}/pull/3`,
          pull_request: { url: `${API}/repos/acme/toolkit/pulls/3` },
        },
      ]),
    ),

    http.get(`${base}/pulls`, () =>
      HttpResponse.json([
        {
          number: 3,
          state: 'open',
          created_at: daysAgo(4),
          updated_at: daysAgo(1),
          closed_at: null,
          merged_at: null,
          draft: false,
          html_url: '',
        },
        {
          number: 4,
          state: 'closed',
          created_at: daysAgo(20),
          updated_at: daysAgo(18),
          closed_at: daysAgo(18),
          merged_at: daysAgo(18),
          draft: false,
          html_url: '',
        },
      ]),
    ),

    http.get(`${base}/releases`, () =>
      HttpResponse.json([
        {
          tag_name: 'v2.0.0',
          published_at: daysAgo(20),
          prerelease: false,
          draft: false,
          html_url: '',
        },
        {
          tag_name: 'v1.9.0',
          published_at: daysAgo(80),
          prerelease: false,
          draft: false,
          html_url: '',
        },
        {
          tag_name: 'v1.8.0',
          published_at: daysAgo(140),
          prerelease: false,
          draft: false,
          html_url: '',
        },
      ]),
    ),

    http.get(`${base}/tags`, () => HttpResponse.json([{ name: 'v2.0.0' }])),
    http.get(`${base}/contributors`, () => HttpResponse.json([{ login: 'ada' }])),

    http.get(`${base}/stats/commit_activity`, () =>
      HttpResponse.json(Array.from({ length: 52 }, (_, week) => ({ total: 6, week }))),
    ),

    http.get(`${base}/actions/workflows`, () =>
      HttpResponse.json({
        total_count: 1,
        workflows: [
          { id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' },
        ],
      }),
    ),

    http.get(`${base}/actions/runs`, () =>
      HttpResponse.json({
        total_count: 3,
        workflow_runs: [
          {
            id: 1,
            conclusion: 'success',
            status: 'completed',
            created_at: daysAgo(1),
            head_branch: 'main',
            html_url: '',
          },
          {
            id: 2,
            conclusion: 'success',
            status: 'completed',
            created_at: daysAgo(2),
            head_branch: 'main',
            html_url: '',
          },
          {
            id: 3,
            conclusion: 'cancelled',
            status: 'completed',
            created_at: daysAgo(3),
            head_branch: 'main',
            html_url: '',
          },
        ],
      }),
    ),

    http.get(`${base}/commits/main/status`, () =>
      HttpResponse.json({ state: 'success', total_count: 1 }),
    ),

    // The normal case for a repository the caller does not administer.
    http.get(`${base}/branches/main/protection`, () =>
      HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
    ),
  ];
}

function makeClient(budget = 60) {
  return new GitHubClient({
    token: 'integration-token',
    budget: new RequestBudget(budget),
    sleep: async () => {},
    random: () => 0.5,
  });
}

async function analyze(options: RepoOptions = {}) {
  const reference = {
    owner: (options.fullName ?? 'acme/toolkit').split('/')[0] ?? 'acme',
    name: (options.fullName ?? 'acme/toolkit').split('/')[1] ?? 'toolkit',
  };
  const snapshot = await collectSnapshot(makeClient(), reference, NOW);
  return { snapshot, result: analyzeSnapshot(snapshot, { now: NOW, analysisId: 'it' }) };
}

describe('full pipeline against a healthy repository', () => {
  // beforeEach, not beforeAll: handlers are reset after every test.
  beforeEach(() => server.use(...healthyHandlers()));

  it('produces a scored analysis for every category', async () => {
    const { result } = await analyze();

    expect(result.categories).toHaveLength(7);
    expect(result.overall.score).not.toBeNull();
    expect(result.overall.score).toBeGreaterThan(70);
  });

  it('excludes pull requests from issue counts across the whole pipeline', async () => {
    // The regression that matters most: the issues endpoint returned three
    // records, one of which is a pull request.
    const { snapshot } = await analyze();

    expect(snapshot.issues?.openCount).toBe(1);
  });

  it('detects security scanning from workflow file contents', async () => {
    const { snapshot } = await analyze();
    expect(snapshot.files.securityScanningWorkflows).toContain('github/codeql-action');
  });

  it('keeps branch protection unverifiable rather than false', async () => {
    const { snapshot, result } = await analyze();

    expect(snapshot.community.defaultBranchProtected).toBeNull();

    const repository = result.categories.find((c) => c.key === 'repository');
    const component = repository?.explanation.components.find(
      (c) => c.id === 'repository.branchProtection',
    );
    expect(component?.score).toBeNull();
  });

  it('excludes cancelled runs from the CI success rate', async () => {
    const { result } = await analyze();
    const ci = result.categories.find((c) => c.key === 'ci');

    // Two successes and one cancelled: the cancelled run is not a failure.
    expect(ci?.metrics.find((m) => m.id === 'ci.runs.successRate')?.value).toBe(100);
  });

  it('serializes cleanly, so the result can be cached', async () => {
    const { result } = await analyze();
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe('full pipeline with partial data', () => {
  it('scores a repository whose issues are disabled without penalising it', async () => {
    server.use(...healthyHandlers({ hasIssues: false, fullName: 'acme/noissues' }));
    const { result } = await analyze({ fullName: 'acme/noissues' });

    const issues = result.categories.find((c) => c.key === 'issues');
    expect(issues?.score).toBeNull();
    expect(result.overall.excluded.map((e) => e.key)).toContain('issues');
    expect(result.overall.score).not.toBeNull();
  });

  it('keeps commit statistics null while GitHub is computing them', async () => {
    // Overrides come first: MSW resolves with the first matching handler.
    server.use(
      http.get(`${API}/repos/acme/computing/stats/commit_activity`, () =>
        HttpResponse.json(null, { status: 202 }),
      ),
      ...healthyHandlers({ fullName: 'acme/computing' }),
    );

    const { snapshot } = await analyze({ fullName: 'acme/computing' });
    expect(snapshot.activity.weeklyCommits).toBeNull();
  });

  it('completes when several endpoints fail, recording each', async () => {
    server.use(
      http.get(`${API}/repos/acme/degraded/actions/workflows`, () =>
        HttpResponse.json({ message: 'Forbidden' }, { status: 403 }),
      ),
      http.get(`${API}/repos/acme/degraded/actions/runs`, () =>
        HttpResponse.json({ message: 'Server error' }, { status: 500 }),
      ),
      ...healthyHandlers({ fullName: 'acme/degraded' }),
    );

    const { snapshot, result } = await analyze({ fullName: 'acme/degraded' });

    const failed = snapshot.collection.failures.map((f) => f.resource);
    expect(failed).toContain('actions/workflows');
    expect(failed).toContain('actions/runs');
    expect(result.overall.score).not.toBeNull();
    expect(result.limitations.join(' ')).toContain('actions/workflows');
  });

  it('does not score an archived repository as neglected', async () => {
    server.use(
      ...healthyHandlers({
        fullName: 'acme/archived',
        archived: true,
        pushedAt: daysAgo(900),
      }),
    );

    const { result } = await analyze({ fullName: 'acme/archived' });
    const activity = result.categories.find((c) => c.key === 'activity');

    expect(activity?.findings.map((f) => f.id)).toContain('activity.archived');
    expect(activity?.findings.map((f) => f.id)).not.toContain('activity.inactive');
  });
});

describe('failure paths end to end', () => {
  it('surfaces a 404 as not_found', async () => {
    server.use(
      http.get(`${API}/repos/acme/missing`, () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
    );

    await expect(
      collectSnapshot(makeClient(), { owner: 'acme', name: 'missing' }, NOW),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('surfaces a rate limit with its reset time', async () => {
    const resetAt = Math.floor(NOW.getTime() / 1000) + 600;
    server.use(
      http.get(`${API}/repos/acme/limited`, () =>
        HttpResponse.json(
          { message: 'API rate limit exceeded' },
          {
            status: 403,
            headers: {
              'x-ratelimit-remaining': '0',
              'x-ratelimit-reset': String(resetAt),
            },
          },
        ),
      ),
    );

    const error = await collectSnapshot(
      makeClient(),
      { owner: 'acme', name: 'limited' },
      NOW,
    ).catch((e) => e);

    expect(error.kind).toBe('rate_limited');
    expect(error.resetAt?.getTime()).toBe(resetAt * 1000);
  });

  it('stops rather than continuing past a rate limit mid-collection', async () => {
    server.use(
      http.get(`${API}/repos/acme/halfway/issues`, () =>
        HttpResponse.json(
          { message: 'rate limited' },
          { status: 429, headers: { 'retry-after': '60' } },
        ),
      ),
      ...healthyHandlers({ fullName: 'acme/halfway' }),
    );

    await expect(
      collectSnapshot(makeClient(), { owner: 'acme', name: 'halfway' }, NOW),
    ).rejects.toMatchObject({ kind: 'rate_limited' });
  });

  it('retries a 5xx and succeeds', async () => {
    let attempts = 0;
    server.use(
      http.get(`${API}/repos/acme/flaky`, () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json({ message: 'boom' }, { status: 503 })
          : HttpResponse.json(repositoryPayload({ fullName: 'acme/flaky' }));
      }),
      ...healthyHandlers({ fullName: 'acme/flaky' }),
    );

    const { result } = await analyze({ fullName: 'acme/flaky' });
    expect(attempts).toBe(2);
    expect(result.repository.fullName).toBe('acme/flaky');
  });

  it('follows GitHub’s canonical redirect for a renamed repository', async () => {
    // GitHub 301s a renamed repository to `repositories/{id}`.
    server.use(
      http.get(`${API}/repos/acme/oldname`, () =>
        HttpResponse.json(null, {
          status: 301,
          headers: { location: `${API}/repositories/777` },
        }),
      ),
      http.get(`${API}/repositories/777`, () =>
        HttpResponse.json(repositoryPayload({ fullName: 'acme/newname', id: 777 })),
      ),
      ...healthyHandlers({ fullName: 'acme/newname', id: 777 }),
    );

    const client = makeClient();
    const response = await client.request<{ full_name: string }>({
      path: 'repos/acme/oldname',
    });

    expect(response.data?.full_name).toBe('acme/newname');
  });
});

describe('analysis service over the pipeline', () => {
  it('caches an analysis and serves it without further requests', async () => {
    server.use(...healthyHandlers({ fullName: 'acme/cached', id: 888 }));

    let requests = 0;
    const service = new AnalysisService({
      store: new MemoryAnalysisStore(),
      logger: createLogger({ write: () => {} }),
      now: () => NOW,
      createClient: (budget) => {
        requests += 1;
        return new GitHubClient({
          token: 'integration-token',
          budget,
          sleep: async () => {},
        });
      },
    });

    const reference = { owner: 'acme', name: 'cached' };
    const first = await service.analyze(reference);
    const second = await service.analyze(reference);

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(requests).toBe(1);
  });
});
