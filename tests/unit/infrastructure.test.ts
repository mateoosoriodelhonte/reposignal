import { describe, expect, it } from 'vitest';

import { createLogger, type LogRecord } from '@/lib/logging/logger';
import { RateLimiter } from '@/lib/rate-limit';
import { MemoryAnalysisStore } from '@/lib/store/memory-store';
import type { StoredAnalysis } from '@/lib/store/types';

import { NOW, buildHealthySnapshot } from '../support/snapshot-builder';

function makeLogger() {
  const lines: string[] = [];
  const logger = createLogger({
    write: (line) => lines.push(line),
    now: () => NOW,
  });
  return { logger, lines, records: () => lines.map((l) => JSON.parse(l) as LogRecord) };
}

describe('logger', () => {
  it('writes one JSON object per line', () => {
    const { logger, lines } = makeLogger();

    logger.info('analysis_started', { repository: 'acme/widget' });
    logger.info('analysis_completed', { repository: 'acme/widget' });

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
      expect(line).not.toContain('\n');
    }
  });

  it('includes level, event, and timestamp on every record', () => {
    const { logger, records } = makeLogger();
    logger.warn('rate_limit_reached', { repository: 'acme/widget' });

    const record = records()[0];
    expect(record?.level).toBe('warn');
    expect(record?.event).toBe('rate_limit_reached');
    expect(record?.timestamp).toBe(NOW.toISOString());
  });

  it.each([
    'token',
    'githubToken',
    'authorization',
    'password',
    'secret',
    'apiKey',
    'accessToken',
    'cookie',
  ])('drops the %s field defensively', (key) => {
    // The real protection is that no caller passes these. Dropping them here
    // means a future careless caller degrades to a missing field rather than a
    // leaked credential.
    const { logger, lines } = makeLogger();
    logger.info('analysis_started', { [key]: 'ghp_secretvalue' });

    expect(lines[0]).not.toContain('ghp_secretvalue');
    expect(lines[0]).not.toContain(key);
  });

  it('omits undefined fields rather than emitting null', () => {
    const { logger, records } = makeLogger();
    logger.info('cache_miss', { repository: 'acme/widget', durationMs: undefined });

    expect(records()[0]).not.toHaveProperty('durationMs');
  });

  it('keeps a legitimately null field, which carries meaning', () => {
    const { logger, records } = makeLogger();
    logger.info('analysis_completed', { score: null });

    expect(records()[0]?.score).toBeNull();
  });
});

describe('MemoryAnalysisStore', () => {
  function entry(githubId: number, fullName: string, createdAt = NOW): StoredAnalysis {
    const snapshot = buildHealthySnapshot({
      identity: { githubId, fullName },
    });
    return {
      snapshot,
      createdAt,
      result: {
        scoringVersion: '1.0.0',
        analysisId: `analysis-${githubId}`,
        analyzedAt: createdAt.toISOString(),
        repository: snapshot.identity,
        overall: {
          score: 80,
          confidence: 'high',
          contributions: [],
          excluded: [],
          formula: '',
        },
        categories: [],
        findings: [],
        limitations: [],
      },
    };
  }

  it('returns null for a repository it has never seen', async () => {
    const store = new MemoryAnalysisStore();
    expect(await store.findLatest(1)).toBeNull();
    expect(await store.findIdByFullName('acme/widget')).toBeNull();
  });

  it('stores and retrieves by GitHub id', async () => {
    const store = new MemoryAnalysisStore();
    await store.save(entry(42, 'acme/widget'));

    expect((await store.findLatest(42))?.result.analysisId).toBe('analysis-42');
  });

  it('resolves a full name to its GitHub id case-insensitively', async () => {
    const store = new MemoryAnalysisStore();
    await store.save(entry(42, 'acme/widget'));

    expect(await store.findIdByFullName('ACME/Widget')).toBe(42);
  });

  it('keeps history keyed on identity when a repository is renamed', async () => {
    // The reason identity is the numeric id: a rename must not fork one
    // project's history into two records.
    const store = new MemoryAnalysisStore();
    await store.save(entry(42, 'acme/widget'));
    await store.save(entry(42, 'acme/gadget'));

    expect(await store.findIdByFullName('acme/gadget')).toBe(42);
    expect((await store.findLatest(42))?.result.repository.fullName).toBe('acme/gadget');
  });

  it('replaces the previous entry for a repository', async () => {
    const store = new MemoryAnalysisStore();
    await store.save(entry(42, 'acme/widget', new Date('2026-01-01T00:00:00Z')));
    await store.save(entry(42, 'acme/widget', new Date('2026-06-01T00:00:00Z')));

    expect(store.size).toBe(1);
    expect((await store.findLatest(42))?.createdAt.toISOString()).toBe(
      '2026-06-01T00:00:00.000Z',
    );
  });

  it('evicts the oldest entries past its cap', async () => {
    const store = new MemoryAnalysisStore(3);

    for (let id = 1; id <= 5; id += 1) {
      await store.save(entry(id, `acme/repo-${id}`));
    }

    expect(store.size).toBe(3);
    expect(await store.findLatest(1)).toBeNull();
    expect(await store.findLatest(5)).not.toBeNull();
    // The evicted entry's name lookup goes with it.
    expect(await store.findIdByFullName('acme/repo-1')).toBeNull();
  });
});

describe('RateLimiter', () => {
  it('allows requests up to the limit', () => {
    const limiter = new RateLimiter(3, 60_000, () => 0);

    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
  });

  it('reports how many requests remain', () => {
    const limiter = new RateLimiter(3, 60_000, () => 0);

    expect(limiter.check('a').remaining).toBe(2);
    expect(limiter.check('a').remaining).toBe(1);
    expect(limiter.check('a').remaining).toBe(0);
  });

  it('reports a positive retry-after when blocked', () => {
    const limiter = new RateLimiter(1, 60_000, () => 0);

    limiter.check('a');
    const blocked = limiter.check('a');

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('does not leak one client’s limit into another', () => {
    const limiter = new RateLimiter(1, 60_000, () => 0);

    expect(limiter.check('client-a').allowed).toBe(true);
    expect(limiter.check('client-b').allowed).toBe(true);
    expect(limiter.check('client-a').allowed).toBe(false);
  });

  it('resets after the window elapses', () => {
    let now = 0;
    const limiter = new RateLimiter(1, 60_000, () => now);

    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);

    now = 60_001;
    expect(limiter.check('a').allowed).toBe(true);
  });

  it('still blocks one millisecond before the window ends', () => {
    let now = 0;
    const limiter = new RateLimiter(1, 60_000, () => now);

    limiter.check('a');
    now = 59_999;
    expect(limiter.check('a').allowed).toBe(false);
  });
});
