import { describe, expect, it, vi } from 'vitest';

import { GitHubClient } from '@/lib/github/client';
import { collectSnapshot } from '@/lib/github/collector';
import { RequestBudget } from '@/lib/github/request-budget';

const NOW = new Date('2026-06-01T00:00:00Z');
const REF = { owner: 'facebook', name: 'react' };

const REPOSITORY = {
  id: 10270250,
  name: 'react',
  full_name: 'facebook/react',
  owner: { login: 'facebook' },
  html_url: 'https://github.com/facebook/react',
  description: 'A JavaScript library',
  created_at: '2013-05-24T16:15:54Z',
  pushed_at: '2026-05-31T00:00:00Z',
  default_branch: 'main',
  archived: false,
  fork: false,
  stargazers_count: 220000,
  forks_count: 45000,
  open_issues_count: 900,
  has_issues: true,
  homepage: 'https://react.dev',
  topics: ['javascript'],
  license: { spdx_id: 'MIT' },
};

/** Base path for the fixture repository, spelled once. */
const REPO = 'repos/facebook/react';

/**
 * Routes requests by exact pathname so a test can describe only the endpoints
 * it cares about. Anything unrouted returns 404, which exercises the
 * collector's "record the absence and carry on" behavior by default.
 *
 * Matching is exact rather than substring because `repos/facebook/react` is a
 * prefix of every other endpoint, so a substring router would send the whole
 * collection to the repository handler.
 */
function makeClient(routes: Record<string, () => Response>) {
  const requested: string[] = [];

  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    requested.push(href);

    const pathname = new URL(href).pathname.replace(/^\//, '');
    const respond = routes[pathname];
    if (respond) return respond();

    return new Response(JSON.stringify({ message: 'Not Found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const client = new GitHubClient({
    token: 'test-token',
    fetchImpl,
    sleep: async () => {},
    random: () => 0.5,
    budget: new RequestBudget(100),
  });

  return { client, requested };
}

function ok(body: unknown, headers: Record<string, string> = {}) {
  return () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', ...headers },
    });
}

function status(code: number) {
  return () =>
    new Response(JSON.stringify({ message: 'nope' }), {
      status: code,
      headers: { 'content-type': 'application/json' },
    });
}

/** Routes just enough for the repository call to succeed. */
const MINIMAL = { [REPO]: ok(REPOSITORY) };

describe('collectSnapshot', () => {
  it('produces a snapshot when only the repository endpoint succeeds', async () => {
    // Every other endpoint 404s. A repository whose workflow runs are
    // unreadable still deserves a documentation score, so partial collection
    // must produce a usable snapshot rather than an exception.
    const { client } = makeClient(MINIMAL);
    const snapshot = await collectSnapshot(client, REF, NOW);

    expect(snapshot.identity.githubId).toBe(10270250);
    expect(snapshot.identity.fullName).toBe('facebook/react');
    expect(snapshot.collection.failures.length).toBeGreaterThan(0);
  });

  it('records each failed endpoint rather than discarding the reason', async () => {
    const { client } = makeClient(MINIMAL);
    const snapshot = await collectSnapshot(client, REF, NOW);

    const resources = snapshot.collection.failures.map((f) => f.resource);
    expect(resources).toContain('actions/workflows');
    expect(snapshot.collection.failures.every((f) => f.reason === 'not_found')).toBe(
      true,
    );
  });

  it('propagates a rate limit rather than continuing with holes', async () => {
    // Continuing after a rate limit would produce a snapshot that is mostly
    // absent data and score it as though the absences were observations.
    const { client } = makeClient({
      [REPO]: ok(REPOSITORY),
      [`${REPO}/contents`]: () =>
        new Response(JSON.stringify({ message: 'rate limited' }), {
          status: 403,
          headers: {
            'content-type': 'application/json',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1800000000',
          },
        }),
    });

    await expect(collectSnapshot(client, REF, NOW)).rejects.toMatchObject({
      kind: 'rate_limited',
    });
  });

  it('lets a repository-level failure reach the caller', async () => {
    const { client } = makeClient({ [REPO]: status(404) });
    await expect(collectSnapshot(client, REF, NOW)).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  it('keeps commit statistics null while GitHub is still computing them', async () => {
    // A 202 means "not yet known". Recording it as zero commits would make an
    // active repository look dead.
    const { client } = makeClient({
      [REPO]: ok(REPOSITORY),
      [`${REPO}/stats/commit_activity`]: () => new Response(null, { status: 202 }),
    });

    const snapshot = await collectSnapshot(client, REF, NOW);
    expect(snapshot.activity.weeklyCommits).toBeNull();
  });

  it('reads commit statistics when they are available', async () => {
    const { client } = makeClient({
      [REPO]: ok(REPOSITORY),
      [`${REPO}/stats/commit_activity`]: ok([
        { total: 5, week: 1 },
        { total: 8, week: 2 },
      ]),
    });

    const snapshot = await collectSnapshot(client, REF, NOW);
    expect(snapshot.activity.weeklyCommits).toEqual([5, 8]);
  });

  it('leaves branch protection null when GitHub refuses the request', async () => {
    // 403 here is the normal case for a repository the caller does not
    // administer. "Unable to verify" must not become "not protected".
    const { client } = makeClient({
      [REPO]: ok(REPOSITORY),
      [`${REPO}/branches/main/protection`]: status(403),
    });

    const snapshot = await collectSnapshot(client, REF, NOW);
    expect(snapshot.community.defaultBranchProtected).toBeNull();
  });

  it('records branch protection when it is readable', async () => {
    const { client } = makeClient({
      [REPO]: ok(REPOSITORY),
      [`${REPO}/branches/main/protection`]: ok({ enabled: true }),
    });

    const snapshot = await collectSnapshot(client, REF, NOW);
    expect(snapshot.community.defaultBranchProtected).toBe(true);
  });

  it('returns a null issue snapshot when issues are disabled', async () => {
    const { client } = makeClient({
      [REPO]: ok({ ...REPOSITORY, has_issues: false }),
    });

    const snapshot = await collectSnapshot(client, REF, NOW);
    expect(snapshot.issues).toBeNull();
  });

  it('counts contributors from the pagination header instead of enumerating them', async () => {
    // per_page=1 makes the last page number equal the total count, turning an
    // unbounded enumeration into a single request.
    const { client, requested } = makeClient({
      [REPO]: ok(REPOSITORY),
      [`${REPO}/contributors`]: ok([{ login: 'a' }], {
        link: '<https://api.github.com/repositories/1/contributors?per_page=1&page=1673>; rel="last"',
      }),
    });

    const snapshot = await collectSnapshot(client, REF, NOW);
    expect(snapshot.activity.contributorCount).toBe(1673);

    const contributorCalls = requested.filter((url) => url.includes('/contributors'));
    expect(contributorCalls).toHaveLength(1);
  });

  it('falls back to the returned length when there is no last link', async () => {
    const { client } = makeClient({
      [REPO]: ok(REPOSITORY),
      [`${REPO}/contributors`]: ok([{ login: 'solo' }]),
    });

    const snapshot = await collectSnapshot(client, REF, NOW);
    expect(snapshot.activity.contributorCount).toBe(1);
  });

  it('excludes pull requests returned by the issues endpoint', async () => {
    const { client } = makeClient({
      [REPO]: ok(REPOSITORY),
      [`${REPO}/issues`]: ok([
        {
          number: 1,
          state: 'open',
          created_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-20T00:00:00Z',
          closed_at: null,
          html_url: 'https://github.com/facebook/react/issues/1',
        },
        {
          number: 2,
          state: 'open',
          created_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-20T00:00:00Z',
          closed_at: null,
          html_url: 'https://github.com/facebook/react/pull/2',
          pull_request: { url: 'https://api.github.com/…' },
        },
      ]),
    });

    const snapshot = await collectSnapshot(client, REF, NOW);
    expect(snapshot.issues?.openCount).toBe(1);
  });

  it('detects security scanning from workflow file contents', async () => {
    const { client } = makeClient({
      [REPO]: ok(REPOSITORY),
      [`${REPO}/contents/.github/workflows`]: ok([
        {
          name: 'codeql.yml',
          path: '.github/workflows/codeql.yml',
          type: 'file',
          size: 500,
          html_url: null,
        },
      ]),
      [`${REPO}/contents/.github/workflows/codeql.yml`]: ok(
        'uses: github/codeql-action/analyze@v3',
      ),
    });

    const snapshot = await collectSnapshot(client, REF, NOW);
    expect(snapshot.files.securityScanningWorkflows).toContain('github/codeql-action');
  });

  it('discards individual records that fail schema validation', async () => {
    // One malformed record must not discard the whole collection.
    const { client } = makeClient({
      [REPO]: ok(REPOSITORY),
      [`${REPO}/issues`]: ok([
        { number: 'not-a-number', state: 'open' },
        {
          number: 2,
          state: 'open',
          created_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-20T00:00:00Z',
          closed_at: null,
          html_url: 'https://github.com/facebook/react/issues/2',
        },
      ]),
    });

    const snapshot = await collectSnapshot(client, REF, NOW);
    expect(snapshot.issues?.openCount).toBe(1);
  });

  it('reports the requests spent so the cost of an analysis is visible', async () => {
    const { client } = makeClient(MINIMAL);
    const snapshot = await collectSnapshot(client, REF, NOW);
    expect(snapshot.collection.requestsMade).toBeGreaterThan(0);
    expect(snapshot.collection.requestsMade).toBe(client.budget.spent);
  });

  it('stamps the snapshot with the injected time, not the wall clock', async () => {
    const { client } = makeClient(MINIMAL);
    const snapshot = await collectSnapshot(client, REF, NOW);
    expect(snapshot.capturedAt).toBe(NOW.toISOString());
  });
});
