import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubClient, parseLinkHeader } from '@/lib/github/client';
import { GitHubError, RateLimitError, isRateLimitError } from '@/lib/github/errors';
import { RequestBudget } from '@/lib/github/request-budget';

const TOKEN = 'ghp_thisIsTheSecretThatMustNeverLeak';

/** Builds a client whose transport, clock, and jitter are all deterministic. */
function makeClient(
  responses: Array<Response | Error>,
  overrides: Partial<ConstructorParameters<typeof GitHubClient>[0]> = {},
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let index = 0;

  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error('No response configured');
    // A Response body can only be read once. The last configured response is
    // reused for any extra calls, so hand out a clone rather than the original.
    return next.clone();
  }) as unknown as typeof fetch;

  const client = new GitHubClient({
    token: TOKEN,
    fetchImpl,
    sleep: async () => {},
    random: () => 0.5,
    ...overrides,
  });

  return { client, calls, fetchImpl };
}

function json(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

describe('parseLinkHeader', () => {
  it('returns an empty object for a missing header', () => {
    expect(parseLinkHeader(null)).toEqual({});
  });

  it('extracts each relation', () => {
    const header =
      '<https://api.github.com/repos/a/b/issues?page=2>; rel="next", ' +
      '<https://api.github.com/repos/a/b/issues?page=9>; rel="last"';
    expect(parseLinkHeader(header)).toEqual({
      next: 'https://api.github.com/repos/a/b/issues?page=2',
      last: 'https://api.github.com/repos/a/b/issues?page=9',
    });
  });

  it('ignores malformed entries rather than throwing', () => {
    expect(parseLinkHeader('garbage; rel=')).toEqual({});
  });
});

describe('GitHubClient request construction', () => {
  it('builds URLs against api.github.com only', async () => {
    const { client, calls } = makeClient([json({ id: 1 })]);
    await client.request({ path: 'repos/facebook/react' });
    expect(calls[0]?.url).toBe('https://api.github.com/repos/facebook/react');
  });

  it.each([
    ['traversal', 'repos/../../admin'],
    ['double slash', 'repos//evil'],
    ['an absolute url', 'https://evil.com/repos/a/b'],
    ['a protocol', 'file:///etc/passwd'],
  ])('refuses to build a request from %s', async (_label, path) => {
    const { client, fetchImpl } = makeClient([json({})]);
    await expect(client.request({ path })).rejects.toThrow(GitHubError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('appends search parameters', async () => {
    const { client, calls } = makeClient([json([])]);
    await client.request({
      path: 'repos/a/b/issues',
      searchParams: { state: 'open', per_page: 100 },
    });
    expect(calls[0]?.url).toContain('state=open');
    expect(calls[0]?.url).toContain('per_page=100');
  });

  it('sends the API version and an identifying user agent', async () => {
    const { client, calls } = makeClient([json({})]);
    await client.request({ path: 'repos/a/b' });
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('x-github-api-version')).toBe('2022-11-28');
    expect(headers.get('user-agent')).toContain('RepoSignal');
  });

  it('sends If-None-Match when given an etag', async () => {
    const { client, calls } = makeClient([json({})]);
    await client.request({ path: 'repos/a/b', etag: 'W/"abc"' });
    expect(new Headers(calls[0]?.init.headers).get('if-none-match')).toBe('W/"abc"');
  });

  it('does not follow redirects, which would escape the API host', async () => {
    const { client } = makeClient([
      new Response(null, { status: 302, headers: { location: 'https://evil.com' } }),
    ]);
    await expect(client.request({ path: 'repos/a/b' })).rejects.toMatchObject({
      kind: 'unexpected',
    });
  });
});

describe('GitHubClient responses', () => {
  it('returns parsed data and the etag', async () => {
    const { client } = makeClient([json({ id: 7 }, { headers: { etag: 'W/"x"' } })]);
    const response = await client.request<{ id: number }>({ path: 'repos/a/b' });
    expect(response.data).toEqual({ id: 7 });
    expect(response.etag).toBe('W/"x"');
  });

  it('returns null data for 304, so callers know their cache is current', async () => {
    const { client } = makeClient([new Response(null, { status: 304 })]);
    const response = await client.request({ path: 'repos/a/b' });
    expect(response.status).toBe(304);
    expect(response.data).toBeNull();
  });

  it('raises invalid_response for malformed JSON', async () => {
    const { client } = makeClient([
      new Response('{not json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ]);
    await expect(client.request({ path: 'repos/a/b' })).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('tracks the reported rate limit state', async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 600;
    const { client } = makeClient([
      json(
        {},
        {
          headers: {
            'x-ratelimit-remaining': '4321',
            'x-ratelimit-limit': '5000',
            'x-ratelimit-reset': String(resetAt),
          },
        },
      ),
    ]);
    await client.request({ path: 'repos/a/b' });
    expect(client.rateLimit.remaining).toBe(4321);
    expect(client.rateLimit.limit).toBe(5000);
    expect(client.rateLimit.resetAt?.getTime()).toBe(resetAt * 1000);
  });
});

describe('GitHubClient error mapping', () => {
  it.each([
    [404, 'not_found'],
    [401, 'forbidden'],
    [451, 'forbidden'],
    [418, 'unexpected'],
  ])('maps %i to %s', async (status, kind) => {
    const { client } = makeClient([json({ message: 'nope' }, { status })]);
    await expect(client.request({ path: 'repos/a/b' })).rejects.toMatchObject({ kind });
  });

  it('maps 403 without rate-limit headers to forbidden', async () => {
    const { client } = makeClient([json({}, { status: 403 })]);
    await expect(client.request({ path: 'repos/a/b' })).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });
});

describe('GitHubClient rate limiting', () => {
  it('maps an exhausted primary limit to RateLimitError with a reset time', async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 900;
    const { client } = makeClient([
      json(
        {},
        {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(resetAt),
          },
        },
      ),
    ]);

    const error = await client.request({ path: 'repos/a/b' }).catch((e) => e);
    expect(isRateLimitError(error)).toBe(true);
    expect((error as RateLimitError).isSecondary).toBe(false);
    expect((error as RateLimitError).resetAt?.getTime()).toBe(resetAt * 1000);
  });

  it('maps 429 with retry-after to a secondary limit', async () => {
    const { client } = makeClient([
      json({}, { status: 429, headers: { 'retry-after': '60' } }),
    ]);
    const error = await client.request({ path: 'repos/a/b' }).catch((e) => e);
    expect(isRateLimitError(error)).toBe(true);
    expect((error as RateLimitError).isSecondary).toBe(true);
    expect((error as RateLimitError).resetAt).toBeInstanceOf(Date);
  });

  it('does not retry into a rate limit', async () => {
    const { client, fetchImpl } = makeClient([
      json({}, { status: 429, headers: { 'retry-after': '60' } }),
    ]);
    await client.request({ path: 'repos/a/b' }).catch(() => {});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('GitHubClient retries', () => {
  it('retries 5xx and succeeds', async () => {
    const { client, fetchImpl } = makeClient([
      json({}, { status: 500 }),
      json({}, { status: 502 }),
      json({ id: 1 }),
    ]);
    const response = await client.request<{ id: number }>({ path: 'repos/a/b' });
    expect(response.data).toEqual({ id: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('gives up after the retry limit', async () => {
    const { client, fetchImpl } = makeClient([json({}, { status: 500 })]);
    await expect(client.request({ path: 'repos/a/b' })).rejects.toMatchObject({
      kind: 'unexpected',
      status: 500,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['404', 404],
    ['401', 401],
    ['422', 422],
  ])('never retries %s', async (_label, status) => {
    const { client, fetchImpl } = makeClient([json({}, { status })]);
    await client.request({ path: 'repos/a/b' }).catch(() => {});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries network failures then reports them', async () => {
    const { client, fetchImpl } = makeClient([new TypeError('connection reset')]);
    await expect(client.request({ path: 'repos/a/b' })).rejects.toMatchObject({
      kind: 'network',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('reports a timeout distinctly from a network failure', async () => {
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    const { client } = makeClient([timeout]);
    await expect(client.request({ path: 'repos/a/b' })).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('does not retry a caller-initiated abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const { client, fetchImpl } = makeClient([new Error('aborted')]);

    await expect(
      client.request({ path: 'repos/a/b', signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('applies bounded jittered backoff rather than a fixed delay', async () => {
    const delays: number[] = [];
    const { client } = makeClient([json({}, { status: 500 })], {
      sleep: async (ms: number) => {
        delays.push(ms);
      },
      maxRetries: 3,
    });

    await client.request({ path: 'repos/a/b' }).catch(() => {});
    expect(delays).toHaveLength(3);
    // Full jitter: each delay lies within [base/2, base] and grows.
    expect(delays[0]).toBeGreaterThanOrEqual(500);
    expect(delays[0]).toBeLessThanOrEqual(1000);
    expect(delays[2]).toBeLessThanOrEqual(8000);
  });
});

describe('GitHubClient request budget', () => {
  it('refuses requests once the budget is spent', async () => {
    const { client, fetchImpl } = makeClient([json({})], {
      budget: new RequestBudget(2),
    });

    await client.request({ path: 'repos/a/b' });
    await client.request({ path: 'repos/a/c' });
    await expect(client.request({ path: 'repos/a/d' })).rejects.toMatchObject({
      kind: 'budget_exhausted',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('counts a request once regardless of how many retries it took', async () => {
    const { client } = makeClient(
      [json({}, { status: 500 }), json({}, { status: 500 }), json({ ok: true })],
      { budget: new RequestBudget(5) },
    );
    await client.request({ path: 'repos/a/b' });
    expect(client.budget.spent).toBe(1);
  });
});

describe('GitHubClient pagination', () => {
  function page(items: unknown[], hasNext: boolean) {
    return json(items, {
      headers: hasNext ? { link: '<https://api.github.com/x?page=2>; rel="next"' } : {},
    });
  }

  it('follows pages until the last one', async () => {
    const { client } = makeClient([
      page([1, 2], true),
      page([3, 4], true),
      page([5], false),
    ]);
    const result = await client.paginate<number>({
      path: 'repos/a/b/issues',
      maxItems: 100,
    });
    expect(result.items).toEqual([1, 2, 3, 4, 5]);
    expect(result.truncated).toBe(false);
  });

  it('reports truncation when it stops at maxItems', async () => {
    const { client } = makeClient([page([1, 2, 3], true)]);
    const result = await client.paginate<number>({
      path: 'repos/a/b/issues',
      maxItems: 3,
    });
    expect(result.items).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it('reports truncation when the budget runs out mid-collection', async () => {
    const { client } = makeClient([page([1, 2], true)], {
      budget: new RequestBudget(1),
    });
    const result = await client.paginate<number>({
      path: 'repos/a/b/issues',
      maxItems: 100,
    });
    expect(result.items).toEqual([1, 2]);
    expect(result.truncated).toBe(true);
  });

  it('handles an empty first page', async () => {
    const { client } = makeClient([page([], false)]);
    const result = await client.paginate<number>({
      path: 'repos/a/b/issues',
      maxItems: 50,
    });
    expect(result.items).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

describe('credential safety', () => {
  let capturedLogs: string[];

  beforeEach(() => {
    capturedLogs = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      capturedLogs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'warn').mockImplementation((...args) => {
      capturedLogs.push(args.map(String).join(' '));
    });
  });

  it('sends the token as a bearer credential', async () => {
    const { client, calls } = makeClient([json({})]);
    await client.request({ path: 'repos/a/b' });
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it('never includes the token in a thrown error', async () => {
    const { client } = makeClient([json({ message: 'no' }, { status: 500 })]);
    const error = await client.request({ path: 'repos/a/b' }).catch((e) => e);

    // Check the message, the stack, and a full serialization of the error.
    const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error as object));
    expect(error.message).not.toContain(TOKEN);
    expect(String(error.stack)).not.toContain(TOKEN);
    expect(serialized).not.toContain(TOKEN);
    expect(capturedLogs.join('\n')).not.toContain(TOKEN);
  });

  it('never includes the token in a rate limit error', async () => {
    const { client } = makeClient([
      json({}, { status: 429, headers: { 'retry-after': '30' } }),
    ]);
    const error = await client.request({ path: 'repos/a/b' }).catch((e) => e);
    const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error as object));
    expect(serialized).not.toContain(TOKEN);
  });

  it('falls back to GITHUB_TOKEN from the environment when none is passed', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'env-token');
    const { client, calls } = makeClient([json({})], { token: undefined });
    await client.request({ path: 'repos/a/b' });
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe(
      'Bearer env-token',
    );
    vi.unstubAllEnvs();
  });

  it('omits the authorization header entirely when no token is configured', async () => {
    // Unauthenticated requests are still valid against public data — they just
    // get a much lower rate limit. Sending `Bearer undefined` would 401.
    vi.stubEnv('GITHUB_TOKEN', '');
    const { client, calls } = makeClient([json({})], { token: undefined });
    await client.request({ path: 'repos/a/b' });
    expect(new Headers(calls[0]?.init.headers).has('authorization')).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe('RequestBudget', () => {
  it('rejects a non-positive limit', () => {
    expect(() => new RequestBudget(0)).toThrow(RangeError);
    expect(() => new RequestBudget(-1)).toThrow(RangeError);
    expect(() => new RequestBudget(1.5)).toThrow(RangeError);
  });

  it('tracks spending and reports exhaustion', () => {
    const budget = new RequestBudget(2);
    expect(budget.remaining).toBe(2);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(false);
    expect(budget.exhausted).toBe(true);
    expect(budget.remaining).toBe(0);
    expect(budget.spent).toBe(2);
  });
});
