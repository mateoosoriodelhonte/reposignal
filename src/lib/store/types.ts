import type { AnalysisResult } from '@/types/analysis';
import type { RepositorySnapshot } from '@/types/snapshot';

/**
 * Persistence boundary for analyses.
 *
 * An interface rather than direct Prisma calls, for one concrete reason: the
 * application must run without a database. Deployments without `DATABASE_URL`
 * fall back to the in-memory implementation, tests use it too, and CI never
 * needs a Postgres service container.
 *
 * Analyses are append-only. Re-analysis inserts a new record rather than
 * mutating one, which gives historical score tracking for free later and makes
 * a cache read a straightforward "most recent, if fresh enough" query.
 */
export interface StoredAnalysis {
  result: AnalysisResult;
  snapshot: RepositorySnapshot;
  createdAt: Date;
}

export interface AnalysisStore {
  /**
   * The most recent analysis for a repository, or `null`.
   *
   * Looked up by GitHub's immutable numeric id, not `owner/name`, so a renamed
   * or transferred repository keeps its history instead of silently forking
   * into two records.
   */
  findLatest(githubId: number): Promise<StoredAnalysis | null>;

  /** Resolves `owner/name` to a GitHub id previously seen, if any. */
  findIdByFullName(fullName: string): Promise<number | null>;

  save(entry: StoredAnalysis): Promise<void>;
}
