import { GitHubClient } from '@/lib/github/client';
import { collectSnapshot } from '@/lib/github/collector';
import { GitHubError, isRateLimitError } from '@/lib/github/errors';
import { fixtureSnapshot, usingFixtures } from '@/lib/github/fixtures';
import { RequestBudget } from '@/lib/github/request-budget';
import type { Logger } from '@/lib/logging/logger';
import { analyzeSnapshot } from '@/lib/scoring';
import { SCORING_VERSION } from '@/lib/scoring/weights';
import type { AnalysisStore } from '@/lib/store/types';
import {
  formatRepositoryReference,
  type RepositoryReference,
} from '@/lib/validation/repository-reference';
import type { AnalysisResult } from '@/types/analysis';
import type { RepositorySnapshot } from '@/types/snapshot';

/**
 * Orchestrates one analysis: cache lookup, collection, scoring, persistence.
 *
 * Three policies live here rather than in the UI, so every entry point gets
 * them consistently:
 *
 * - **Freshness.** A cached analysis younger than the window is served
 *   directly, without touching GitHub.
 * - **Deduplication.** Concurrent requests for the same repository share one
 *   in-flight promise, so ten simultaneous visitors cost one analysis.
 * - **Version invalidation.** A cached analysis produced under a different
 *   `scoringVersion` is not served, because its numbers mean something else.
 */

export const DEFAULT_FRESHNESS_MINUTES = 15;

export interface AnalysisOutcome {
  result: AnalysisResult;
  /** Whether this came from cache, and how old it was. */
  cached: boolean;
  ageSeconds: number;
}

export interface AnalysisServiceOptions {
  store: AnalysisStore;
  logger: Logger;
  freshnessMinutes?: number;
  requestBudget?: number;
  /** Injected so tests control time; defaults to the wall clock. */
  now?: () => Date;
  /** Injected so tests control ids; defaults to a random UUID. */
  generateId?: () => string;
  /** Injected for tests. */
  createClient?: (budget: RequestBudget) => GitHubClient;
}

export class AnalysisService {
  #inFlight = new Map<string, Promise<AnalysisOutcome>>();

  constructor(private readonly options: AnalysisServiceOptions) {}

  #now(): Date {
    return this.options.now?.() ?? new Date();
  }

  #freshnessMs(): number {
    return (this.options.freshnessMinutes ?? DEFAULT_FRESHNESS_MINUTES) * 60_000;
  }

  /**
   * Analyzes a repository, serving a fresh cached result when one exists.
   *
   * `forceRefresh` bypasses the cache. It is exposed so a user can ask for
   * current data after acting on a finding, and is rate limited separately by
   * the caller.
   */
  async analyze(
    reference: RepositoryReference,
    options: { forceRefresh?: boolean } = {},
  ): Promise<AnalysisOutcome> {
    const fullName = formatRepositoryReference(reference);
    const key = `${fullName.toLowerCase()}:${options.forceRefresh === true}`;

    // Deduplication: ten concurrent visitors to a popular repository should
    // cost one analysis, not ten.
    const existing = this.#inFlight.get(key);
    if (existing) return existing;

    const work = this.#analyzeUncached(reference, fullName, options).finally(() => {
      this.#inFlight.delete(key);
    });

    this.#inFlight.set(key, work);
    return work;
  }

  async #analyzeUncached(
    reference: RepositoryReference,
    fullName: string,
    options: { forceRefresh?: boolean },
  ): Promise<AnalysisOutcome> {
    const { store, logger } = this.options;
    const startedAt = Date.now();

    if (options.forceRefresh !== true) {
      const cached = await this.#readCache(fullName);
      if (cached !== null) return cached;
    }

    const analysisId = this.options.generateId?.() ?? crypto.randomUUID();
    logger.info('analysis_started', { analysisId, repository: fullName });

    const budget = new RequestBudget(this.options.requestBudget ?? 40);
    const client = this.options.createClient?.(budget) ?? new GitHubClient({ budget });

    try {
      const now = this.#now();
      const snapshot = await this.#collect(reference, client, now, fullName);
      const result = analyzeSnapshot(snapshot, { now, analysisId });

      // Persistence failure must not fail an analysis that already succeeded.
      // The user gets their result; the cache simply misses next time.
      try {
        await store.save({ result, snapshot, createdAt: now });
      } catch (error) {
        logger.warn('store_unavailable', {
          analysisId,
          repository: fullName,
          reason: error instanceof Error ? error.name : 'unknown',
        });
      }

      logger.info('analysis_completed', {
        analysisId,
        repository: fullName,
        score: result.overall.score,
        durationMs: Date.now() - startedAt,
        requestsMade: snapshot.collection.requestsMade,
        rateLimitRemaining: snapshot.collection.rateLimitRemaining,
        scoringVersion: result.scoringVersion,
      });

      return { result, cached: false, ageSeconds: 0 };
    } catch (error) {
      if (isRateLimitError(error)) {
        logger.warn('rate_limit_reached', {
          analysisId,
          repository: fullName,
          resetAt: error.resetAt?.toISOString() ?? null,
          isSecondary: error.isSecondary,
        });
      } else {
        logger.error('analysis_failed', {
          analysisId,
          repository: fullName,
          reason: error instanceof GitHubError ? error.kind : 'unexpected',
          durationMs: Date.now() - startedAt,
        });
      }

      throw error;
    }
  }

  /**
   * Collects a snapshot, or serves a bundled one in fixture mode.
   *
   * Fixture mode exists so E2E can run against a production build without
   * touching GitHub. An unknown repository in fixture mode raises the same
   * `not_found` error the real client would, so the not-found path is
   * exercised rather than special-cased.
   */
  async #collect(
    reference: RepositoryReference,
    client: GitHubClient,
    now: Date,
    fullName: string,
  ): Promise<RepositorySnapshot> {
    if (!usingFixtures()) {
      return collectSnapshot(client, reference, now);
    }

    const fixture = fixtureSnapshot(reference, now);
    if (fixture === null) {
      throw new GitHubError('not_found', 'That repository could not be found.', {
        status: 404,
        resource: fullName,
      });
    }
    return fixture;
  }

  async #readCache(fullName: string): Promise<AnalysisOutcome | null> {
    const { store, logger } = this.options;

    let githubId: number | null;
    try {
      githubId = await store.findIdByFullName(fullName);
    } catch {
      // An unreachable store is a cache miss, not an analysis failure.
      return null;
    }

    if (githubId === null) {
      logger.info('cache_miss', { repository: fullName });
      return null;
    }

    const stored = await store.findLatest(githubId).catch(() => null);
    if (stored === null) {
      logger.info('cache_miss', { repository: fullName });
      return null;
    }

    // A result produced under different rules is not a cache hit — its numbers
    // mean something else, and serving it would misrepresent them as current.
    if (stored.result.scoringVersion !== SCORING_VERSION) {
      logger.info('cache_miss', {
        repository: fullName,
        reason: 'scoring_version_changed',
        scoringVersion: stored.result.scoringVersion,
      });
      return null;
    }

    const ageMs = this.#now().getTime() - stored.createdAt.getTime();
    if (ageMs > this.#freshnessMs() || ageMs < 0) {
      logger.info('cache_miss', {
        repository: fullName,
        reason: 'stale',
        ageSeconds: Math.round(ageMs / 1000),
      });
      return null;
    }

    const ageSeconds = Math.max(0, Math.round(ageMs / 1000));
    logger.info('cache_hit', {
      analysisId: stored.result.analysisId,
      repository: fullName,
      ageSeconds,
    });

    return { result: stored.result, cached: true, ageSeconds };
  }
}
