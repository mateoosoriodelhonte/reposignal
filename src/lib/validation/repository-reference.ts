import { z } from 'zod';

/**
 * The SSRF boundary.
 *
 * Everything a user types arrives here, and only a validated `{ owner, name }`
 * pair leaves. The GitHub client builds request URLs from those two components
 * against a hardcoded host — no user-supplied string is ever fetched, and no
 * user-supplied string is ever interpolated into a URL without passing through
 * this module first.
 *
 * The rules below are GitHub's actual naming constraints, not approximations.
 * Being strict here is what makes the guarantee downstream meaningful.
 */

/** Owners: alphanumeric and single hyphens, no leading or trailing hyphen. */
const OWNER_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

/** Repository names: alphanumerics plus `.`, `_`, `-`. */
const NAME_PATTERN = /^[a-zA-Z0-9._-]{1,100}$/;

/** Hosts a GitHub repository reference may legitimately name. */
const ALLOWED_HOSTS = new Set(['github.com', 'www.github.com']);

const ownerSchema = z
  .string()
  .min(1, 'Owner is required.')
  .max(39, 'GitHub usernames are at most 39 characters.')
  .regex(OWNER_PATTERN, 'That is not a valid GitHub owner name.');

const nameSchema = z
  .string()
  .min(1, 'Repository name is required.')
  .max(100, 'GitHub repository names are at most 100 characters.')
  .regex(NAME_PATTERN, 'That is not a valid GitHub repository name.')
  // `.` and `..` are valid against the character class but are path segments,
  // not repositories. Excluding them closes a traversal vector.
  .refine((value) => value !== '.' && value !== '..', {
    message: 'That is not a valid GitHub repository name.',
  });

export const repositoryReferenceSchema = z.object({
  owner: ownerSchema,
  name: nameSchema,
});

export type RepositoryReference = z.infer<typeof repositoryReferenceSchema>;

export type ParseResult =
  { ok: true; value: RepositoryReference } | { ok: false; error: string };

/** GitHub appends `.git` to clone URLs; it is not part of the name. */
function stripGitSuffix(name: string): string {
  return name.endsWith('.git') ? name.slice(0, -4) : name;
}

/**
 * Extracts `owner/name` from the leading two path segments, ignoring anything
 * deeper. This is what lets a pasted deep link — `/tree/main/src`, `/issues`,
 * `/pull/42` — resolve to the repository it belongs to.
 */
function fromPathSegments(pathname: string): ParseResult {
  const [owner, rawName] = pathname.split('/').filter((segment) => segment.length > 0);

  if (owner === undefined || rawName === undefined) {
    return { ok: false, error: 'That URL does not name a repository.' };
  }

  return validate(owner, stripGitSuffix(rawName));
}

function validate(owner: string, name: string): ParseResult {
  const parsed = repositoryReferenceSchema.safeParse({ owner, name });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? 'That is not a valid repository.' };
  }

  return { ok: true, value: parsed.data };
}

/**
 * Parses any reasonable way a person might identify a GitHub repository.
 *
 * Accepted:
 *   owner/repo
 *   github.com/owner/repo
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/main/src
 *   git@github.com:owner/repo.git
 *
 * Everything else is rejected. Notably rejected: any non-GitHub host, hosts
 * that merely contain "github.com" as a substring, embedded credentials, and
 * protocol-relative URLs.
 *
 * Returns a result rather than throwing, so callers cannot forget to handle
 * the failure path.
 */
export function parseRepositoryReference(input: string): ParseResult {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return { ok: false, error: 'Enter a repository, for example facebook/react.' };
  }

  // Reject before parsing rather than after. A protocol-relative URL would
  // otherwise be resolved against whatever base the URL parser is given.
  if (trimmed.startsWith('//')) {
    return { ok: false, error: 'Enter a GitHub repository, for example facebook/react.' };
  }

  // SCP-style remote: git@github.com:owner/repo.git
  const scpMatch = /^git@([^:]+):(.+)$/.exec(trimmed);
  if (scpMatch?.[1] !== undefined && scpMatch[2] !== undefined) {
    const [, host, path] = scpMatch;
    if (!ALLOWED_HOSTS.has(host.toLowerCase())) {
      return { ok: false, error: 'Only GitHub repositories can be analyzed.' };
    }
    return fromPathSegments(`/${path}`);
  }

  const looksLikeUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  const looksLikeBareHost = /^(?:www\.)?github\.com\//i.test(trimmed);

  if (looksLikeUrl || looksLikeBareHost) {
    let url: URL;
    try {
      url = new URL(looksLikeUrl ? trimmed : `https://${trimmed}`);
    } catch {
      return { ok: false, error: 'That is not a valid URL.' };
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { ok: false, error: 'Only GitHub repositories can be analyzed.' };
    }

    // Credentials in a URL are never legitimate here and are a classic way to
    // disguise the real host from a human reader.
    if (url.username !== '' || url.password !== '') {
      return { ok: false, error: 'Only GitHub repositories can be analyzed.' };
    }

    // Exact host match. A substring check would accept `github.com.evil.com`.
    if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
      return { ok: false, error: 'Only GitHub repositories can be analyzed.' };
    }

    return fromPathSegments(url.pathname);
  }

  // Bare `owner/repo`. Any additional segment makes it ambiguous.
  const parts = trimmed.split('/');
  const [owner, rawName] = parts;
  if (parts.length !== 2 || owner === undefined || rawName === undefined) {
    return {
      ok: false,
      error: 'Enter a repository as owner/name, or paste a GitHub URL.',
    };
  }

  return validate(owner, stripGitSuffix(rawName));
}

/** Canonical `owner/name`, used for display and as a cache lookup key. */
export function formatRepositoryReference(reference: RepositoryReference): string {
  return `${reference.owner}/${reference.name}`;
}
