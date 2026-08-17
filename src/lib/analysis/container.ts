import 'server-only';

import { logger } from '@/lib/logging/logger';
import { RateLimiter } from '@/lib/rate-limit';
import { MemoryAnalysisStore } from '@/lib/store/memory-store';
import type { AnalysisStore } from '@/lib/store/types';

import { AnalysisService } from './service';

/**
 * Application wiring.
 *
 * `server-only` at the top makes importing this from a client component a build
 * error rather than a runtime surprise, which is what keeps the GitHub token
 * out of the browser bundle.
 *
 * The store is chosen at startup: Postgres when `DATABASE_URL` is set,
 * in-memory otherwise. RepoSignal works either way — without a database,
 * cached analyses simply do not survive a restart.
 */

let store: AnalysisStore | undefined;
let service: AnalysisService | undefined;

async function resolveStore(): Promise<AnalysisStore> {
  if (store) return store;

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl === undefined || databaseUrl === '') {
    logger.warn('store_unavailable', {
      reason: 'no_database_url',
      detail: 'Falling back to the in-memory store; analyses will not survive a restart.',
    });
    store = new MemoryAnalysisStore();
    return store;
  }

  // Imported lazily so a deployment without a database never loads the Prisma
  // client or the pg driver at all.
  const { PrismaAnalysisStore, getPrismaClient } =
    await import('@/lib/store/prisma-store');

  store = new PrismaAnalysisStore(getPrismaClient(databaseUrl));
  return store;
}

export async function getAnalysisService(): Promise<AnalysisService> {
  if (service) return service;

  const freshness = Number.parseInt(process.env.ANALYSIS_FRESHNESS_MINUTES ?? '', 10);
  const budget = Number.parseInt(process.env.GITHUB_REQUEST_BUDGET ?? '', 10);

  service = new AnalysisService({
    store: await resolveStore(),
    logger,
    ...(Number.isFinite(freshness) && freshness > 0
      ? { freshnessMinutes: freshness }
      : {}),
    ...(Number.isFinite(budget) && budget > 0 ? { requestBudget: budget } : {}),
  });

  return service;
}

/**
 * Per-client limits.
 *
 * Analysis is capped generously because most requests are cache hits. Refresh
 * is capped tightly because every one of them spends GitHub rate limit.
 */
export const analysisRateLimiter = new RateLimiter(30, 60_000);
export const refreshRateLimiter = new RateLimiter(5, 300_000);
