import { GitHubError, RateLimitError } from './errors';
import { RequestBudget } from './request-budget';

/**
 * The only host RepoSignal ever contacts.
 *
 * Requests are built by joining validated path components onto this constant.
 * No user-supplied string is ever used as a URL, and redirects away from this
 * host are not followed. Together with the input validation in
 * `src/lib/validation/repository-reference.ts`, this is the SSRF boundary.
 */
const API_BASE = 'https://api.github.com';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BUDGET = 40;

/**
 * Statuses that mean "go somewhere else". Deliberately enumerated rather than
 * checked as a 3xx range, because 304 Not Modified shares that range and is a
 * cache validation result, not a redirect.
 */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Redirect hops allowed per request. GitHub's canonicalization is one hop;
 * more than a few means something is wrong.
 */
const MAX_REDIRECTS = 3;

/** GitHub asks for an explicit API version and a descriptive user agent. */
const BASE_HEADERS: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'RepoSignal (+https://github.com/mateoosoriodelhonte/reposignal)',
};

export interface RateLimitState {
  remaining: number | null;
  limit: number | null;
  resetAt: Date | null;
}

export interface GitHubResponse<T> {
  data: T;
  status: number;
  /** Parsed `link` header relations, e.g. `{ next: '...' }`. */
  links: Record<string, string>;
  etag: string | null;
}

export interface GitHubClientOptions {
  token?: string | undefined;
  timeoutMs?: number;
  maxRetries?: number;
  budget?: RequestBudget;
  /** Injected for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injected so retry backoff is instant in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so jitter is deterministic in tests. */
  random?: () => number;
}

export interface RequestOptions {
  /** Path relative to the API base, e.g. `repos/facebook/react`. */
  path: string;
  searchParams?: Record<string, string | number>;
  /** Sent as `If-None-Match` so an unchanged resource costs no rate limit. */
  etag?: string | null;
  /** Override the default Accept header, e.g. for raw file contents. */
  accept?: string;
  /**
   * How to read the body. `text` is needed for raw file contents, which
   * GitHub returns as the file itself rather than as JSON.
   */
  parse?: 'json' | 'text';
  signal?: AbortSignal;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses a `Link` header into its relations.
 *
 * Only `rel` values are extracted; the URLs are used for pagination detection
 * rather than being fetched directly, so a malicious `Link` cannot redirect
 * collection off GitHub.
 */
export function parseLinkHeader(header: string | null): Record<string, string> {
  if (!header) return {};

  const links: Record<string, string> = {};
  for (const part of header.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="([^"]+)"/.exec(part.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) {
      links[match[2]] = match[1];
    }
  }
  return links;
}

function parseRateLimit(headers: Headers): RateLimitState {
  const remaining = headers.get('x-ratelimit-remaining');
  const limit = headers.get('x-ratelimit-limit');
  const reset = headers.get('x-ratelimit-reset');

  return {
    remaining: remaining === null ? null : Number.parseInt(remaining, 10),
    limit: limit === null ? null : Number.parseInt(limit, 10),
    resetAt: reset === null ? null : new Date(Number.parseInt(reset, 10) * 1000),
  };
}

/**
 * A thin, typed client over `fetch`.
 *
 * It exists instead of Octokit because RepoSignal needs policies that are
 * awkward to express on top of a general-purpose client: a hard per-analysis
 * request budget, sample truncation surfaced to the caller rather than hidden,
 * and rate-limit handling that fails fast with a reset time instead of
 * retrying into the limit.
 */
export class GitHubClient {
  readonly budget: RequestBudget;
  #token: string | undefined;
  #timeoutMs: number;
  #maxRetries: number;
  #fetch: typeof fetch;
  #sleep: (ms: number) => Promise<void>;
  #random: () => number;
  #rateLimit: RateLimitState = { remaining: null, limit: null, resetAt: null };

  constructor(options: GitHubClientOptions = {}) {
    this.#token = options.token ?? process.env.GITHUB_TOKEN;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.budget = options.budget ?? new RequestBudget(DEFAULT_BUDGET);
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#random = options.random ?? Math.random;
  }

  /** The most recent rate-limit state GitHub reported. */
  get rateLimit(): RateLimitState {
    return this.#rateLimit;
  }

  #buildUrl(path: string, searchParams?: Record<string, string | number>): string {
    // Reject anything that could escape the API base. Callers pass fixed
    // path templates with validated components interpolated, so a `..` or a
    // scheme here means a bug upstream, not a legitimate request.
    if (path.includes('..') || path.includes('//') || /^[a-z]+:/i.test(path)) {
      throw new GitHubError('unexpected', 'Refusing to build a request from that path.', {
        resource: path,
      });
    }

    const url = new URL(`${API_BASE}/${path.replace(/^\//, '')}`);

    if (url.origin !== API_BASE) {
      throw new GitHubError('unexpected', 'Refusing to request a non-GitHub origin.', {
        resource: path,
      });
    }

    for (const [key, value] of Object.entries(searchParams ?? {})) {
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  #headers(options: RequestOptions): Headers {
    const headers = new Headers(BASE_HEADERS);
    if (options.accept !== undefined) headers.set('Accept', options.accept);
    if (this.#token) headers.set('Authorization', `Bearer ${this.#token}`);
    if (options.etag) headers.set('If-None-Match', options.etag);
    return headers;
  }

  /**
   * Retry delay with full jitter.
   *
   * Jitter matters more than the base delay here: without it, several
   * concurrent analyses that hit a 5xx together would retry in lockstep and
   * hit GitHub again simultaneously.
   */
  #backoffMs(attempt: number): number {
    const base = Math.min(1000 * 2 ** attempt, 8000);
    return Math.floor(base * (0.5 + this.#random() * 0.5));
  }

  /**
   * Performs one GitHub request.
   *
   * Returns `null` data on `304 Not Modified`, which is how the caller learns
   * its cached copy is still current. A `304` costs no rate limit, which is
   * the entire reason ETags are threaded through.
   */
  async request<T>(options: RequestOptions): Promise<GitHubResponse<T | null>> {
    if (!this.budget.tryConsume()) {
      throw new GitHubError(
        'budget_exhausted',
        'This analysis reached its GitHub request budget.',
        { resource: options.path },
      );
    }

    let url = this.#buildUrl(options.path, options.searchParams);
    let redirects = 0;
    let attempt = 0;
    let lastError: unknown;

    for (;;) {
      const timeout = AbortSignal.timeout(this.#timeoutMs);
      const signal = options.signal
        ? AbortSignal.any([options.signal, timeout])
        : timeout;

      let response: Response;
      try {
        response = await this.#fetch(url, {
          method: 'GET',
          headers: this.#headers(options),
          signal,
          // Redirects are followed manually so each hop's target can be
          // checked against the API origin. Letting fetch follow them
          // automatically would allow a redirect off api.github.com.
          redirect: 'manual',
        });
      } catch (cause) {
        // A caller-initiated abort is not a transient fault; do not retry it.
        if (options.signal?.aborted) {
          throw new GitHubError('timeout', 'The request was cancelled.', {
            resource: options.path,
            cause,
          });
        }

        lastError = cause;
        if (attempt < this.#maxRetries) {
          await this.#sleep(this.#backoffMs(attempt));
          attempt += 1;
          continue;
        }

        const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
        throw new GitHubError(
          timedOut ? 'timeout' : 'network',
          timedOut ? 'GitHub did not respond in time.' : 'Could not reach GitHub.',
          { resource: options.path, cause },
        );
      }

      this.#rateLimit = parseRateLimit(response.headers);

      // 304 is checked before the redirect guard below: it shares the 3xx
      // range but is a cache validation result, not a redirect.
      if (response.status === 304) {
        return {
          data: null,
          status: 304,
          links: parseLinkHeader(response.headers.get('link')),
          etag: response.headers.get('etag'),
        };
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        url = this.#resolveRedirect(response, url, options.path, redirects);
        redirects += 1;
        continue;
      }

      if (response.ok) {
        let data: T;
        try {
          data =
            options.parse === 'text'
              ? ((await response.text()) as T)
              : ((await response.json()) as T);
        } catch (cause) {
          throw new GitHubError('invalid_response', 'GitHub returned malformed JSON.', {
            status: response.status,
            resource: options.path,
            cause,
          });
        }

        return {
          data,
          status: response.status,
          links: parseLinkHeader(response.headers.get('link')),
          etag: response.headers.get('etag'),
        };
      }

      // Retry server errors only. A 4xx will not become a 2xx by asking again.
      if (response.status >= 500 && attempt < this.#maxRetries) {
        await this.#sleep(this.#backoffMs(attempt));
        attempt += 1;
        continue;
      }

      throw this.#toError(response, options.path);
    }

    /* c8 ignore next 4 -- unreachable: the loop returns or throws every path */
    throw new GitHubError('unexpected', 'GitHub request failed.', {
      resource: options.path,
      cause: lastError,
    });
  }

  /**
   * Validates a redirect target and returns it.
   *
   * GitHub legitimately redirects `repos/{owner}/{name}` to its canonical
   * `repositories/{id}` URL for any repository that has ever been renamed or
   * transferred — `facebook/react` among them. Refusing all redirects made
   * those repositories unanalyzable.
   *
   * The SSRF concern was never same-origin canonicalization; it is a redirect
   * to a *different* host. So each hop is resolved and its origin checked
   * against the API base, and the hop count is bounded so a redirect loop
   * cannot spin.
   */
  #resolveRedirect(
    response: Response,
    currentUrl: string,
    resource: string,
    redirectsSoFar: number,
  ): string {
    if (redirectsSoFar >= MAX_REDIRECTS) {
      throw new GitHubError('unexpected', 'GitHub redirected too many times.', {
        status: response.status,
        resource,
      });
    }

    const location = response.headers.get('location');
    if (location === null || location === '') {
      throw new GitHubError('unexpected', 'GitHub redirected without a target.', {
        status: response.status,
        resource,
      });
    }

    let target: URL;
    try {
      target = new URL(location, currentUrl);
    } catch {
      throw new GitHubError('unexpected', 'GitHub redirected to an invalid target.', {
        status: response.status,
        resource,
      });
    }

    if (target.origin !== API_BASE) {
      throw new GitHubError(
        'unexpected',
        'Refusing to follow a redirect away from the GitHub API.',
        { status: response.status, resource },
      );
    }

    return target.toString();
  }

  #toError(response: Response, resource: string): GitHubError {
    const { status, headers } = response;
    const remaining = headers.get('x-ratelimit-remaining');
    const retryAfter = headers.get('retry-after');

    // GitHub signals the primary rate limit as 403/429 with remaining=0, and
    // the secondary (abuse) limit as 403/429 with a retry-after header.
    if (status === 429 || (status === 403 && (remaining === '0' || retryAfter))) {
      const isSecondary = remaining !== '0';
      let resetAt = this.#rateLimit.resetAt;

      if (retryAfter !== null) {
        const seconds = Number.parseInt(retryAfter, 10);
        if (Number.isFinite(seconds)) {
          resetAt = new Date(Date.now() + seconds * 1000);
        }
      }

      return new RateLimitError(
        isSecondary
          ? 'GitHub is temporarily throttling requests.'
          : 'GitHub API rate limit reached.',
        { resetAt, isSecondary, status, resource },
      );
    }

    switch (status) {
      case 404:
        return new GitHubError('not_found', 'That repository could not be found.', {
          status,
          resource,
        });
      case 401:
        return new GitHubError('forbidden', 'GitHub rejected the credentials.', {
          status,
          resource,
        });
      case 403:
        return new GitHubError('forbidden', 'GitHub denied access to that resource.', {
          status,
          resource,
        });
      case 451:
        return new GitHubError(
          'forbidden',
          'That repository is unavailable for legal reasons.',
          {
            status,
            resource,
          },
        );
      default:
        return new GitHubError('unexpected', `GitHub returned an unexpected status.`, {
          status,
          resource,
        });
    }
  }

  /**
   * Fetches up to `maxItems` records, following pagination.
   *
   * Returns what it collected plus whether more exists, so the caller can
   * record the truncation on the snapshot and lower confidence accordingly.
   * Stopping quietly at a page boundary and reporting the result as complete
   * is the failure mode this signature exists to prevent.
   */
  async paginate<T>(
    options: RequestOptions & { maxItems: number; perPage?: number },
  ): Promise<{ items: T[]; truncated: boolean }> {
    const perPage = Math.min(options.perPage ?? 100, 100);
    const items: T[] = [];
    let page = 1;

    while (items.length < options.maxItems) {
      if (this.budget.exhausted) {
        return { items, truncated: true };
      }

      const response = await this.request<T[]>({
        ...options,
        searchParams: {
          ...options.searchParams,
          per_page: perPage,
          page,
        },
      });

      const batch = response.data;
      if (!Array.isArray(batch) || batch.length === 0) {
        return { items, truncated: false };
      }

      items.push(...batch);

      if (response.links['next'] === undefined) {
        return { items, truncated: false };
      }
      page += 1;
    }

    return { items: items.slice(0, options.maxItems), truncated: true };
  }
}
