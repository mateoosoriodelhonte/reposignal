import { z } from 'zod';

/**
 * Zod schemas for the GitHub payloads RepoSignal reads.
 *
 * These are the last place GitHub's vocabulary is allowed to appear. They are
 * deliberately loose about fields RepoSignal does not use (`.loose()` keeps
 * unknown keys rather than rejecting them) and strict about the ones it does,
 * because a silently-missing field would become a silently-wrong score.
 *
 * Every optional field maps to `null` downstream, never to a default.
 */

export const repositorySchema = z
  .object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    owner: z.object({ login: z.string() }),
    html_url: z.string(),
    description: z.string().nullable().default(null),
    created_at: z.string(),
    pushed_at: z.string().nullable().default(null),
    default_branch: z.string(),
    archived: z.boolean().default(false),
    fork: z.boolean().default(false),
    stargazers_count: z.number().default(0),
    forks_count: z.number().default(0),
    open_issues_count: z.number().default(0),
    has_issues: z.boolean().default(true),
    homepage: z.string().nullable().default(null),
    topics: z.array(z.string()).default([]),
    license: z.object({ spdx_id: z.string().nullable() }).nullable().default(null),
  })
  .loose();

export type RawRepository = z.infer<typeof repositorySchema>;

/**
 * GitHub's issues endpoints return pull requests as issues. The presence of
 * `pull_request` is the only reliable discriminator, which is why it is
 * modelled here rather than filtered by guesswork downstream.
 */
export const issueSchema = z
  .object({
    number: z.number(),
    state: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    closed_at: z.string().nullable().default(null),
    html_url: z.string(),
    pull_request: z.unknown().optional(),
  })
  .loose();

export type RawIssue = z.infer<typeof issueSchema>;

export const pullRequestSchema = z
  .object({
    number: z.number(),
    state: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    closed_at: z.string().nullable().default(null),
    merged_at: z.string().nullable().default(null),
    draft: z.boolean().default(false),
    html_url: z.string(),
  })
  .loose();

export type RawPullRequest = z.infer<typeof pullRequestSchema>;

export const releaseSchema = z
  .object({
    tag_name: z.string(),
    published_at: z.string().nullable().default(null),
    prerelease: z.boolean().default(false),
    draft: z.boolean().default(false),
    html_url: z.string(),
  })
  .loose();

export type RawRelease = z.infer<typeof releaseSchema>;

export const workflowSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    path: z.string(),
    state: z.string(),
  })
  .loose();

export const workflowListSchema = z
  .object({
    total_count: z.number().default(0),
    workflows: z.array(workflowSchema).default([]),
  })
  .loose();

export const workflowRunSchema = z
  .object({
    id: z.number(),
    conclusion: z.string().nullable().default(null),
    status: z.string().nullable().default(null),
    created_at: z.string(),
    head_branch: z.string().nullable().default(null),
    html_url: z.string(),
  })
  .loose();

export const workflowRunListSchema = z
  .object({
    total_count: z.number().default(0),
    workflow_runs: z.array(workflowRunSchema).default([]),
  })
  .loose();

export const combinedStatusSchema = z
  .object({
    state: z.string(),
    total_count: z.number().default(0),
  })
  .loose();

/**
 * One entry from a directory listing. RepoSignal reads listings rather than
 * file contents wherever presence alone is the signal, because a listing costs
 * one request for an entire directory.
 */
export const contentEntrySchema = z
  .object({
    name: z.string(),
    path: z.string(),
    type: z.string(),
    size: z.number().default(0),
    html_url: z.string().nullable().default(null),
  })
  .loose();

export const contentListSchema = z.array(contentEntrySchema);

export type RawContentEntry = z.infer<typeof contentEntrySchema>;

/** Weekly commit activity. GitHub returns `202` with no body while computing. */
export const commitActivitySchema = z.array(
  z.object({ total: z.number(), week: z.number() }).loose(),
);
