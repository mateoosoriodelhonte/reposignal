/**
 * Typed errors for everything that can go wrong talking to GitHub.
 *
 * Callers switch on `kind` rather than parsing messages, and the analysis
 * layer maps each kind to a distinct user-facing explanation. A generic
 * "something went wrong" is the failure this taxonomy exists to prevent.
 *
 * No error carries a token, an authorization header, or a raw response body.
 */

export type GitHubErrorKind =
  | 'not_found'
  | 'rate_limited'
  | 'forbidden'
  | 'timeout'
  | 'network'
  | 'budget_exhausted'
  | 'invalid_response'
  | 'unexpected';

export class GitHubError extends Error {
  readonly kind: GitHubErrorKind;
  /** HTTP status, when the failure came from a response. */
  readonly status?: number;
  /** The resource being requested, e.g. `repos/facebook/react`. Never a URL
   *  with credentials, and never the token. */
  readonly resource?: string;

  constructor(
    kind: GitHubErrorKind,
    message: string,
    options: { status?: number; resource?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'GitHubError';
    this.kind = kind;
    if (options.status !== undefined) this.status = options.status;
    if (options.resource !== undefined) this.resource = options.resource;
  }
}

/**
 * Raised when GitHub's rate limit is reached.
 *
 * `resetAt` is what lets the UI say when access returns instead of asking the
 * user to try again vaguely later. RepoSignal does not retry into a rate
 * limit — waiting out a limit inside a request handler just converts a fast
 * failure into a slow one.
 */
export class RateLimitError extends GitHubError {
  readonly resetAt: Date | null;
  /** True for the secondary (abuse) limit, which has no fixed reset time. */
  readonly isSecondary: boolean;

  constructor(
    message: string,
    options: {
      resetAt?: Date | null;
      isSecondary?: boolean;
      status?: number;
      resource?: string;
    } = {},
  ) {
    super('rate_limited', message, {
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.resource === undefined ? {} : { resource: options.resource }),
    });
    this.name = 'RateLimitError';
    this.resetAt = options.resetAt ?? null;
    this.isSecondary = options.isSecondary ?? false;
  }
}

export function isGitHubError(error: unknown): error is GitHubError {
  return error instanceof GitHubError;
}

export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}
