import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import type { AnalysisResult } from '@/types/analysis';
import type { RepositorySnapshot } from '@/types/snapshot';

import type { AnalysisStore, StoredAnalysis } from './types';

/**
 * Postgres-backed analysis store.
 *
 * Prisma 7 requires a driver adapter rather than a connection string in the
 * schema, so the client is constructed here with `PrismaPg`.
 *
 * The client is memoized on `globalThis` because Next.js recreates modules on
 * every hot reload in development, and a fresh connection pool per reload
 * exhausts Postgres connections within a few edits.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getPrismaClient(databaseUrl: string): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = client;
  }

  return client;
}

export class PrismaAnalysisStore implements AnalysisStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findLatest(githubId: number): Promise<StoredAnalysis | null> {
    const row = await this.prisma.analysis.findFirst({
      where: { repositoryId: BigInt(githubId) },
      orderBy: { createdAt: 'desc' },
    });

    if (row === null) return null;

    return {
      result: row.result as unknown as AnalysisResult,
      snapshot: row.snapshot as unknown as RepositorySnapshot,
      createdAt: row.createdAt,
    };
  }

  async findIdByFullName(fullName: string): Promise<number | null> {
    const row = await this.prisma.repository.findFirst({
      where: { fullName },
      orderBy: { lastSeen: 'desc' },
    });

    return row === null ? null : Number(row.githubId);
  }

  async save(entry: StoredAnalysis): Promise<void> {
    const identity = entry.result.repository;
    const githubId = BigInt(identity.githubId);

    // Upsert the repository, then append the analysis. Both in one transaction
    // so a crash between them cannot leave an analysis without its repository.
    await this.prisma.$transaction([
      this.prisma.repository.upsert({
        where: { githubId },
        create: {
          githubId,
          owner: identity.owner,
          name: identity.name,
          fullName: identity.fullName,
        },
        // A rename shows up here: the identity is unchanged, the name is not.
        update: {
          owner: identity.owner,
          name: identity.name,
          fullName: identity.fullName,
        },
      }),
      this.prisma.analysis.create({
        data: {
          repositoryId: githubId,
          overallScore: entry.result.overall.score,
          scoringVersion: entry.result.scoringVersion,
          result: JSON.parse(JSON.stringify(entry.result)),
          snapshot: JSON.parse(JSON.stringify(entry.snapshot)),
          createdAt: entry.createdAt,
        },
      }),
    ]);
  }
}
