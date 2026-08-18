import { describe, expect, it, vi } from 'vitest';

import { AnalysisService } from '@/lib/analysis/service';
import { GitHubClient } from '@/lib/github/client';
import { RequestBudget } from '@/lib/github/request-budget';
import { createLogger, type LogRecord } from '@/lib/logging/logger';
import { SCORING_VERSION } from '@/lib/scoring/weights';
import { MemoryAnalysisStore } from '@/lib/store/memory-store';

const NOW = new Date('2026-06-01T12:00:00Z');
const REF = { owner: 'acme', name: 'widget' };
const REPO_PATH = 'repos/acme/widget';

const REPOSITORY = {
  id: 42,
  name: 'widget',
  full_name: 'acme/widget',
  owner: { login: 'acme' },
  html_url: 'https://github.com/acme/widget',
  description: 'A widget',
  created_at: '2020-01-01T00:00:00Z',
  pushed_at: '2026-05-30T00:00:00Z',
  default_branch: 'main',
  archived: false,
  fork: false,
  stargazers_count: 100,
  forks_count: 10,
  open_issues_count: 3,
  has_issues: true,
  homepage: null,
  topics: ['tools'],
  license: { spdx_id: 'MIT' },
};

/** A client whose only successful endpoint is the repository itself. */
function stubClient(budget: RequestBudget, onRequest?: () => void) {
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    onRequest?.();
    const pathname = new URL(String(url)).pathname.replace(/^\//, '');

    if (pathname === REPO_PATH) {
      return new Response(JSON.stringify(REPOSITORY), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ message: 'Not Found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return new GitHubClient({
    token: 'test-token',
    fetchImpl,
    sleep: async () => {},
    random: () => 0.5,
    budget,
  });
}

function makeService(
  overrides: Partial<ConstructorParameters<typeof AnalysisService>[0]> = {},
) {
  const records: LogRecord[] = [];
  const store = new MemoryAnalysisStore();
  let clock = NOW;
  let idCounter = 0;
  let githubCalls = 0;

  const service = new AnalysisService({
    store,
    logger: createLogger({
      write: (line) => records.push(JSON.parse(line) as LogRecord),
      now: () => clock,
    }),
    now: () => clock,
    generateId: () => `analysis-${++idCounter}`,
    createClient: (budget) => stubClient(budget, () => (githubCalls += 1)),
    ...overrides,
  });

  return {
    service,
    store,
    records,
    events: () => records.map((r) => r.event),
    githubCalls: () => githubCalls,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

describe('AnalysisService', () => {
  it('analyzes a repository and returns a scored result', async () => {
    const { service } = makeService();
    const outcome = await service.analyze(REF);

    expect(outcome.cached).toBe(false);
    expect(outcome.result.repository.fullName).toBe('acme/widget');
    expect(outcome.result.scoringVersion).toBe(SCORING_VERSION);
    expect(outcome.result.categories).toHaveLength(7);
  });

  it('persists the analysis so it can be served from cache', async () => {
    const { service, store } = makeService();
    await service.analyze(REF);

    const stored = await store.findLatest(42);
    expect(stored?.result.repository.githubId).toBe(42);
  });

  describe('caching', () => {
    it('serves a fresh cached analysis without contacting GitHub', async () => {
      const { service, githubCalls } = makeService();

      await service.analyze(REF);
      const callsAfterFirst = githubCalls();

      const second = await service.analyze(REF);

      expect(second.cached).toBe(true);
      expect(githubCalls()).toBe(callsAfterFirst);
    });

    it('re-analyzes once the freshness window has passed', async () => {
      const { service, advance, githubCalls } = makeService({ freshnessMinutes: 15 });

      await service.analyze(REF);
      const callsAfterFirst = githubCalls();

      advance(16 * 60_000);
      const second = await service.analyze(REF);

      expect(second.cached).toBe(false);
      expect(githubCalls()).toBeGreaterThan(callsAfterFirst);
    });

    it('serves from cache right up to the freshness boundary', async () => {
      const { service, advance } = makeService({ freshnessMinutes: 15 });

      await service.analyze(REF);
      advance(14 * 60_000);

      expect((await service.analyze(REF)).cached).toBe(true);
    });

    it('reports how old a cached result is', async () => {
      const { service, advance } = makeService();

      await service.analyze(REF);
      advance(7 * 60_000);

      expect((await service.analyze(REF)).ageSeconds).toBe(420);
    });

    it('bypasses the cache on a forced refresh', async () => {
      const { service, githubCalls } = makeService();

      await service.analyze(REF);
      const callsAfterFirst = githubCalls();

      const refreshed = await service.analyze(REF, { forceRefresh: true });

      expect(refreshed.cached).toBe(false);
      expect(githubCalls()).toBeGreaterThan(callsAfterFirst);
    });

    it('ignores a cached analysis produced under a different scoring version', async () => {
      // Its numbers mean something else, so serving it would misrepresent
      // them as current.
      const { service, store, githubCalls } = makeService();
      await service.analyze(REF);

      const stored = await store.findLatest(42);
      if (stored === null) throw new Error('expected a stored analysis');
      await store.save({
        ...stored,
        result: { ...stored.result, scoringVersion: '0.9.0' },
      });

      const callsBefore = githubCalls();
      const second = await service.analyze(REF);

      expect(second.cached).toBe(false);
      expect(githubCalls()).toBeGreaterThan(callsBefore);
    });

    it('is keyed case-insensitively on the repository name', async () => {
      const { service } = makeService();

      await service.analyze(REF);
      const second = await service.analyze({ owner: 'ACME', name: 'Widget' });

      expect(second.cached).toBe(true);
    });
  });

  describe('deduplication', () => {
    it('shares one analysis across concurrent requests', async () => {
      // Ten simultaneous visitors to a popular repository should cost one
      // analysis, not ten.
      const { service, githubCalls } = makeService();

      const outcomes = await Promise.all(
        Array.from({ length: 10 }, () => service.analyze(REF)),
      );

      expect(outcomes).toHaveLength(10);
      const ids = new Set(outcomes.map((o) => o.result.analysisId));
      expect(ids.size).toBe(1);

      // One analysis worth of requests, not ten.
      expect(githubCalls()).toBeLessThan(30);
    });

    it('releases the in-flight entry so later requests still work', async () => {
      const { service } = makeService();

      await Promise.all([service.analyze(REF), service.analyze(REF)]);
      const later = await service.analyze(REF, { forceRefresh: true });

      expect(later.result).toBeDefined();
    });

    it('does not let a forced refresh join a cached-path request', async () => {
      const { service } = makeService();

      const [normal, forced] = await Promise.all([
        service.analyze(REF),
        service.analyze(REF, { forceRefresh: true }),
      ]);

      expect(normal.result.analysisId).not.toBe(forced.result.analysisId);
    });
  });

  describe('failures', () => {
    it('propagates a repository-level failure', async () => {
      const { service } = makeService({
        createClient: (budget) =>
          new GitHubClient({
            token: 'test-token',
            budget,
            sleep: async () => {},
            fetchImpl: (async () =>
              new Response(JSON.stringify({ message: 'Not Found' }), {
                status: 404,
                headers: { 'content-type': 'application/json' },
              })) as unknown as typeof fetch,
          }),
      });

      await expect(service.analyze(REF)).rejects.toMatchObject({ kind: 'not_found' });
    });

    it('still returns a result when the store cannot save', async () => {
      // The user's analysis succeeded. A persistence failure means the cache
      // misses next time, not that the work is discarded.
      const failingStore = {
        findLatest: async () => null,
        findIdByFullName: async () => null,
        save: async () => {
          throw new Error('database unreachable');
        },
      };

      const { service, events } = makeService({ store: failingStore });
      const outcome = await service.analyze(REF);

      expect(outcome.result).toBeDefined();
      expect(events()).toContain('store_unavailable');
    });

    it('treats an unreadable store as a cache miss', async () => {
      const failingStore = {
        findLatest: async () => null,
        findIdByFullName: async () => {
          throw new Error('database unreachable');
        },
        save: async () => {},
      };

      const { service } = makeService({ store: failingStore });
      expect((await service.analyze(REF)).cached).toBe(false);
    });
  });

  describe('fixture mode', () => {
    it('calls GitHub unless fixtures are explicitly requested', async () => {
      // Regression: fixture mode was read from `process.env` inside the
      // service, so a workflow-wide GITHUB_FIXTURES silently redirected the
      // unit suite to bundled data and every test analyzing acme/widget
      // failed with not_found. It is now an explicit option.
      vi.stubEnv('GITHUB_FIXTURES', '1');

      const { service, githubCalls } = makeService();
      const outcome = await service.analyze(REF);

      expect(outcome.result.repository.fullName).toBe('acme/widget');
      expect(githubCalls()).toBeGreaterThan(0);

      vi.unstubAllEnvs();
    });

    it('serves a bundled snapshot when fixtures are requested', async () => {
      const { service, githubCalls } = makeService({ useFixtures: true });
      const outcome = await service.analyze({ owner: 'acme', name: 'toolkit' });

      expect(outcome.result.repository.fullName).toBe('acme/toolkit');
      expect(githubCalls()).toBe(0);
    });

    it('reports an unknown repository as not found in fixture mode', async () => {
      const { service } = makeService({ useFixtures: true });
      await expect(
        service.analyze({ owner: 'acme', name: 'nope' }),
      ).rejects.toMatchObject({
        kind: 'not_found',
      });
    });
  });

  describe('private repositories', () => {
    // The service treats an installation-scoped analysis as private. These are
    // the properties that stop one session's private result reaching another.

    it('never writes a private analysis to the shared store', async () => {
      const { service, store } = makeService();

      await service.analyze(REF, { installationId: 99, installationToken: 'ghs_x' });

      expect(await store.findIdByFullName('acme/widget')).toBeNull();
      expect(await store.findLatest(42)).toBeNull();
    });

    it('never serves a private analysis from the shared store', async () => {
      // Even if a public analysis of the same repository were cached, a private
      // request must re-collect under its own installation rather than inherit it.
      const { service, githubCalls } = makeService();

      await service.analyze(REF);
      const afterPublic = githubCalls();

      const privateOutcome = await service.analyze(REF, {
        installationId: 99,
        installationToken: 'ghs_x',
      });

      expect(privateOutcome.cached).toBe(false);
      expect(githubCalls()).toBeGreaterThan(afterPublic);
    });

    it('does not let a private analysis populate the cache for anonymous users', async () => {
      const { service, githubCalls } = makeService();

      await service.analyze(REF, { installationId: 99, installationToken: 'ghs_x' });
      const afterPrivate = githubCalls();

      const anonymous = await service.analyze(REF);

      expect(anonymous.cached).toBe(false);
      expect(githubCalls()).toBeGreaterThan(afterPrivate);
    });

    it('does not share an in-flight analysis between two installations', async () => {
      // Deduplication is keyed on the installation as well as the repository.
      // Sharing would hand session B the result of session A's access.
      const { service } = makeService();

      const [a, b] = await Promise.all([
        service.analyze(REF, { installationId: 1, installationToken: 'ghs_a' }),
        service.analyze(REF, { installationId: 2, installationToken: 'ghs_b' }),
      ]);

      expect(a.result.analysisId).not.toBe(b.result.analysisId);
    });

    it('does not share an in-flight analysis between a session and an anonymous visitor', async () => {
      const { service } = makeService();

      const [anonymous, authenticated] = await Promise.all([
        service.analyze(REF),
        service.analyze(REF, { installationId: 1, installationToken: 'ghs_a' }),
      ]);

      expect(anonymous.result.analysisId).not.toBe(authenticated.result.analysisId);
    });

    it('passes the installation token to the GitHub client', async () => {
      const tokens: Array<string | undefined> = [];
      const { service } = makeService({
        createClient: (budget, token) => {
          tokens.push(token);
          return stubClient(budget);
        },
      });

      await service.analyze(REF, { installationId: 7, installationToken: 'ghs_secret' });
      expect(tokens).toEqual(['ghs_secret']);
    });

    it('uses no token for an anonymous analysis', async () => {
      const tokens: Array<string | undefined> = [];
      const { service } = makeService({
        createClient: (budget, token) => {
          tokens.push(token);
          return stubClient(budget);
        },
      });

      await service.analyze(REF);
      expect(tokens).toEqual([undefined]);
    });

    it('never logs the installation token', async () => {
      const { service, records } = makeService();
      await service.analyze(REF, {
        installationId: 7,
        installationToken: 'ghs_verysecret',
      });

      expect(JSON.stringify(records)).not.toContain('ghs_verysecret');
    });
  });

  describe('logging', () => {
    it('logs the start and completion of an analysis with a shared id', async () => {
      const { service, records } = makeService();
      await service.analyze(REF);

      const started = records.find((r) => r.event === 'analysis_started');
      const completed = records.find((r) => r.event === 'analysis_completed');

      expect(started?.analysisId).toBeDefined();
      expect(completed?.analysisId).toBe(started?.analysisId);
      expect(completed?.repository).toBe('acme/widget');
      expect(typeof completed?.durationMs).toBe('number');
    });

    it('logs a cache hit with the age of the result', async () => {
      const { service, advance, records } = makeService();

      await service.analyze(REF);
      advance(60_000);
      await service.analyze(REF);

      const hit = records.find((r) => r.event === 'cache_hit');
      expect(hit?.ageSeconds).toBe(60);
    });

    it('logs a failure with its reason', async () => {
      const { service, records } = makeService({
        createClient: (budget) =>
          new GitHubClient({
            token: 'test-token',
            budget,
            sleep: async () => {},
            fetchImpl: (async () =>
              new Response('{}', {
                status: 404,
                headers: { 'content-type': 'application/json' },
              })) as unknown as typeof fetch,
          }),
      });

      await service.analyze(REF).catch(() => {});

      const failed = records.find((r) => r.event === 'analysis_failed');
      expect(failed?.reason).toBe('not_found');
    });

    it('never writes a token into any log line', async () => {
      const { service, records } = makeService();
      await service.analyze(REF);

      const serialized = JSON.stringify(records);
      expect(serialized).not.toContain('test-token');
      expect(serialized.toLowerCase()).not.toContain('authorization');
    });
  });
});
