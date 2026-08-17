import {
  normalizeActivity,
  normalizeCi,
  normalizeCommunity,
  normalizeFiles,
  normalizeIdentity,
  normalizeIssues,
  normalizePullRequests,
} from '@/lib/normalize/snapshot';
import type { RepositoryReference } from '@/lib/validation/repository-reference';
import type { CollectionReport, RepositorySnapshot } from '@/types/snapshot';

import type { GitHubClient } from './client';
import { GitHubError } from './errors';
import {
  commitActivitySchema,
  combinedStatusSchema,
  contentListSchema,
  issueSchema,
  pullRequestSchema,
  releaseSchema,
  repositorySchema,
  workflowListSchema,
  workflowRunListSchema,
} from './schemas';

/**
 * Assembles a `RepositorySnapshot` from GitHub.
 *
 * The organising principle: **only the repository itself is required.** Every
 * other endpoint is allowed to fail, and a failure records an entry in the
 * `CollectionReport` and leaves its field `null` rather than aborting. A
 * repository whose workflow runs are unreadable still deserves a documentation
 * score.
 *
 * The exception is a rate limit, which is rethrown. Continuing after one would
 * produce a snapshot that is mostly holes and score it as though the holes
 * were observations.
 */

/** Caps on how much of each collection is sampled, to bound the request cost. */
const SAMPLE_LIMITS = {
  issues: 300,
  pullRequests: 200,
  releases: 100,
  workflowRuns: 100,
  workflowFiles: 5,
} as const;

class Collector {
  readonly failures: CollectionReport['failures'] = [];

  constructor(
    private readonly client: GitHubClient,
    private readonly ref: RepositoryReference,
  ) {}

  get base(): string {
    return `repos/${this.ref.owner}/${this.ref.name}`;
  }

  /**
   * Runs a collection step, converting failure into a recorded absence.
   *
   * Rate limits are rethrown: they affect every remaining step, so continuing
   * would silently degrade the whole analysis rather than one field of it.
   */
  async attempt<T>(resource: string, run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof GitHubError && error.kind === 'rate_limited') {
        throw error;
      }

      this.failures.push({
        resource,
        reason: error instanceof GitHubError ? error.kind : 'unexpected',
      });
      return null;
    }
  }
}

/** Lists a directory, treating "no such directory" as an empty listing. */
async function listDirectory(
  client: GitHubClient,
  path: string,
): Promise<
  Array<{
    name: string;
    path: string;
    type: string;
    size: number;
    html_url: string | null;
  }>
> {
  const response = await client.request<unknown>({ path });
  const parsed = contentListSchema.safeParse(response.data);
  return parsed.success ? parsed.data : [];
}

/**
 * Counts a collection without enumerating it.
 *
 * Requesting one item per page makes the `last` link's page number equal the
 * total count. That turns an unbounded enumeration — 4,000 contributors is
 * 40 requests at 100 per page — into exactly one.
 */
async function countViaPagination(
  client: GitHubClient,
  path: string,
): Promise<number | null> {
  const response = await client.request<unknown[]>({
    path,
    searchParams: { per_page: 1 },
  });

  const last = response.links['last'];
  if (last !== undefined) {
    const page = new URL(last).searchParams.get('page');
    if (page !== null) {
      const parsed = Number.parseInt(page, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  // No `last` link means zero or one page, so the item count is what came back.
  return Array.isArray(response.data) ? response.data.length : null;
}

export async function collectSnapshot(
  client: GitHubClient,
  ref: RepositoryReference,
  now: Date,
): Promise<RepositorySnapshot> {
  const collector = new Collector(client, ref);
  const base = collector.base;

  // The repository itself is the one required call. Its failure — a 404, a
  // private repository — is the caller's to handle.
  const repositoryResponse = await client.request<unknown>({ path: base });
  const repository = repositorySchema.parse(repositoryResponse.data);
  const identity = normalizeIdentity(repository);

  // Everything below depends only on the repository call above, so the
  // independent collections run concurrently. Sequentially this took ~14s on a
  // large repository; concurrently it is a few seconds. The request budget is
  // still enforced per request, so concurrency cannot overspend it.
  const [
    rootEntries,
    githubDirEntries,
    workflowFiles,
    issuesResult,
    pullsResult,
    releasesResult,
    tagCount,
    contributorCount,
    weeklyCommits,
    workflows,
    runs,
    commitStatus,
    branchProtected,
  ] = await Promise.all([
    collector
      .attempt('contents', () => listDirectory(client, `${base}/contents`))
      .then((entries) => entries ?? []),

    collector
      .attempt('contents/.github', () =>
        listDirectory(client, `${base}/contents/.github`),
      )
      .then((entries) => entries ?? []),

    collector
      .attempt('contents/.github/workflows', () =>
        listDirectory(client, `${base}/contents/.github/workflows`),
      )
      .then((entries) => entries ?? []),

    collector.attempt('issues', () =>
      client.paginate<unknown>({
        path: `${base}/issues`,
        searchParams: { state: 'all', sort: 'created', direction: 'desc' },
        maxItems: SAMPLE_LIMITS.issues,
      }),
    ),

    collector.attempt('pulls', () =>
      client.paginate<unknown>({
        path: `${base}/pulls`,
        searchParams: { state: 'all', sort: 'created', direction: 'desc' },
        maxItems: SAMPLE_LIMITS.pullRequests,
      }),
    ),

    collector.attempt('releases', () =>
      client.paginate<unknown>({
        path: `${base}/releases`,
        maxItems: SAMPLE_LIMITS.releases,
      }),
    ),

    collector.attempt('tags', () => countViaPagination(client, `${base}/tags`)),

    collector.attempt('contributors', () =>
      countViaPagination(client, `${base}/contributors`),
    ),

    collector.attempt('stats/commit_activity', async () => {
      const response = await client.request<unknown>({
        path: `${base}/stats/commit_activity`,
      });
      // GitHub answers 202 with no body while it computes statistics. That is
      // "not yet known", which must stay null rather than becoming zero commits.
      if (response.status === 202 || response.data === null) return null;

      const parsed = commitActivitySchema.safeParse(response.data);
      return parsed.success ? parsed.data.map((week) => week.total) : null;
    }),

    collector.attempt('actions/workflows', async () => {
      const response = await client.request<unknown>({
        path: `${base}/actions/workflows`,
      });
      return workflowListSchema.safeParse(response.data);
    }),

    collector.attempt('actions/runs', async () => {
      const response = await client.request<unknown>({
        path: `${base}/actions/runs`,
        searchParams: {
          branch: identity.defaultBranch,
          per_page: SAMPLE_LIMITS.workflowRuns,
        },
      });
      return workflowRunListSchema.safeParse(response.data);
    }),

    collector.attempt('commit status', async () => {
      const response = await client.request<unknown>({
        path: `${base}/commits/${identity.defaultBranch}/status`,
      });
      const parsed = combinedStatusSchema.safeParse(response.data);
      if (!parsed.success) return null;
      // `pending` with no checks at all means there is no CI on this commit,
      // which is different from a check that is still running.
      return parsed.data.total_count === 0 ? 'none' : parsed.data.state;
    }),

    // Branch protection requires elevated permissions on most repositories.
    // A 403 or 404 here is expected and must stay `null` — "unable to verify" —
    // rather than being recorded as "not protected".
    collector.attempt('branch protection', async () => {
      await client.request<unknown>({
        path: `${base}/branches/${identity.defaultBranch}/protection`,
      });
      return true;
    }),
  ]);

  const hasIssueTemplates = githubDirEntries.some(
    (entry) => entry.type === 'dir' && entry.name.toLowerCase() === 'issue_template',
  );
  const hasPullRequestTemplate = githubDirEntries.some(
    (entry) =>
      entry.type === 'file' &&
      entry.name.toLowerCase().startsWith('pull_request_template'),
  );

  // Workflow file contents are read as text to detect security scanning steps.
  // Nothing is executed or evaluated — see SECURITY.md.
  const workflowContents = (
    await Promise.all(
      workflowFiles.slice(0, SAMPLE_LIMITS.workflowFiles).map((entry) =>
        collector.attempt(`workflow:${entry.name}`, async () => {
          // Requested as raw text: GitHub returns the file itself, not JSON.
          const response = await client.request<string>({
            path: `${base}/contents/${entry.path}`,
            accept: 'application/vnd.github.raw',
            parse: 'text',
          });
          return response.data ?? '';
        }),
      ),
    )
  ).filter((content): content is string => content !== null);

  const issueRaws = (issuesResult?.items ?? [])
    .map((item) => issueSchema.safeParse(item))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));

  const pullRaws = (pullsResult?.items ?? [])
    .map((item) => pullRequestSchema.safeParse(item))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));

  const releaseRaws = (releasesResult?.items ?? [])
    .map((item) => releaseSchema.safeParse(item))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));

  const workflowList = workflows?.success ? workflows.data : null;
  const runList = runs?.success ? runs.data : null;

  return {
    capturedAt: now.toISOString(),
    identity,
    activity: normalizeActivity({
      repository,
      releases: releaseRaws,
      weeklyCommits: weeklyCommits ?? null,
      contributorCount: contributorCount ?? null,
      tagCount: tagCount ?? null,
    }),
    issues: normalizeIssues({
      raws: issueRaws,
      sample: {
        examined: issueRaws.length,
        truncated: issuesResult?.truncated ?? false,
      },
      hasIssuesEnabled: repository.has_issues,
      now,
    }),
    pullRequests: normalizePullRequests({
      raws: pullRaws,
      sample: {
        examined: pullRaws.length,
        truncated: pullsResult?.truncated ?? false,
      },
      now,
    }),
    ci: normalizeCi({
      workflowCount: workflowList?.total_count ?? null,
      workflowFileNames: workflowList?.workflows.map((w) => w.path) ?? [],
      runConclusions: runList?.workflow_runs.map((run) => run.conclusion) ?? [],
      latestCommitStatus: commitStatus ?? null,
      sample: {
        examined: runList?.workflow_runs.length ?? 0,
        truncated: (runList?.total_count ?? 0) > SAMPLE_LIMITS.workflowRuns,
      },
    }),
    files: normalizeFiles({
      rootEntries,
      githubDirEntries,
      hasIssueTemplates,
      hasPullRequestTemplate,
      workflowContents,
    }),
    community: normalizeCommunity({
      repository,
      defaultBranchProtected: branchProtected,
    }),
    collection: {
      requestsMade: client.budget.spent,
      failures: collector.failures,
      rateLimitRemaining: client.rateLimit.remaining,
    },
  };
}
