import { describe, expect, it, vi } from 'vitest';

import type { GitHubAppConfig } from '@/lib/auth/github-app';
import { InstallationTokenProvider } from '@/lib/auth/installation';

import { TEST_PRIVATE_KEY } from '../../support/rsa-key';

const CONFIG: GitHubAppConfig = {
  appId: '123456',
  clientId: 'Iv1.test',
  clientSecret: 'test-client-secret',
  privateKey: TEST_PRIVATE_KEY,
  sessionSecret: 'a-secret-that-is-at-least-32-characters-long',
};

const NOW = new Date('2026-06-01T12:00:00Z');

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeProvider(
  responses: Array<() => Response>,
  options: { now?: () => Date } = {},
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let index = 0;

  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const respond = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (respond === undefined) throw new Error('no response configured');
    return respond();
  }) as unknown as typeof fetch;

  const provider = new InstallationTokenProvider(CONFIG, {
    fetchImpl,
    now: options.now ?? (() => NOW),
  });

  return { provider, calls, fetchImpl };
}

const tokenResponse =
  (token = 'ghs_installationtoken', minutes = 60) =>
  () =>
    json({
      token,
      expires_at: new Date(NOW.getTime() + minutes * 60_000).toISOString(),
    });

describe('InstallationTokenProvider.getToken', () => {
  it('mints a token for an installation', async () => {
    const { provider, calls } = makeProvider([tokenResponse()]);
    const result = await provider.getToken(42);

    expect(result.token).toBe('ghs_installationtoken');
    expect(calls[0]?.url).toBe(
      'https://api.github.com/app/installations/42/access_tokens',
    );
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('authenticates the mint request with the App JWT, not a static secret', async () => {
    const { provider, calls } = makeProvider([tokenResponse()]);
    await provider.getToken(42);

    const auth = String(new Headers(calls[0]?.init.headers).get('authorization'));
    expect(auth.startsWith('Bearer ')).toBe(true);
    // A JWT, not the client secret.
    expect(auth.split('.')).toHaveLength(3);
    expect(auth).not.toContain('test-client-secret');
  });

  it('reuses a cached token rather than minting per request', async () => {
    // One analysis makes ~22 requests; minting per request would be absurd.
    const { provider, fetchImpl } = makeProvider([tokenResponse()]);

    await provider.getToken(42);
    await provider.getToken(42);
    await provider.getToken(42);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps installations separate', async () => {
    const { provider, fetchImpl } = makeProvider([
      tokenResponse('token-a'),
      tokenResponse('token-b'),
    ]);

    const a = await provider.getToken(1);
    const b = await provider.getToken(2);

    expect(a.token).toBe('token-a');
    expect(b.token).toBe('token-b');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refreshes before expiry rather than after a failure', async () => {
    // A token that expires mid-analysis would fail requests that had already
    // been budgeted for. The margin avoids ever finding out.
    let clock = NOW;
    const { provider, fetchImpl } = makeProvider(
      [tokenResponse('first', 60), tokenResponse('second', 60)],
      { now: () => clock },
    );

    await provider.getToken(42);
    // 56 minutes later: 4 minutes of life left, inside the 5-minute margin.
    clock = new Date(NOW.getTime() + 56 * 60_000);
    const refreshed = await provider.getToken(42);

    expect(refreshed.token).toBe('second');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('still uses a cached token comfortably before the margin', async () => {
    let clock = NOW;
    const { provider, fetchImpl } = makeProvider([tokenResponse('first', 60)], {
      now: () => clock,
    });

    await provider.getToken(42);
    clock = new Date(NOW.getTime() + 30 * 60_000);
    await provider.getToken(42);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports a revoked installation distinctly', async () => {
    // The normal signal that a user removed the App.
    const { provider } = makeProvider([() => json({ message: 'Not Found' }, 404)]);

    await expect(provider.getToken(42)).rejects.toMatchObject({
      reason: 'installation_unavailable',
    });
  });

  it('drops the cached token when an installation goes away', async () => {
    const { provider, fetchImpl } = makeProvider([
      tokenResponse('good'),
      () => json({ message: 'Not Found' }, 404),
      tokenResponse('new'),
    ]);

    await provider.getToken(42);
    await provider.getToken(42).catch(() => {});
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    provider.invalidate(42);
    await provider.getToken(42).catch(() => {});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects a malformed token response rather than caching nonsense', async () => {
    const { provider } = makeProvider([() => json({ token: 12345 })]);
    await expect(provider.getToken(42)).rejects.toMatchObject({
      reason: 'exchange_failed',
    });
  });

  it('rejects an unreadable expiry', async () => {
    const { provider } = makeProvider([
      () => json({ token: 'ghs_x', expires_at: 'not-a-date' }),
    ]);
    await expect(provider.getToken(42)).rejects.toMatchObject({
      reason: 'exchange_failed',
    });
  });
});

describe('InstallationTokenProvider.listRepositories', () => {
  it('lists what the installation actually grants', async () => {
    const { provider } = makeProvider([
      tokenResponse(),
      () =>
        json({
          repositories: [
            { id: 2, full_name: 'acme/private-service', private: true },
            { id: 1, full_name: 'acme/public-lib', private: false },
          ],
        }),
    ]);

    const repositories = await provider.listRepositories(42);

    // Sorted by full name: "private-service" precedes "public-lib".
    expect(repositories).toEqual([
      { githubId: 2, fullName: 'acme/private-service', isPrivate: true },
      { githubId: 1, fullName: 'acme/public-lib', isPrivate: false },
    ]);
  });

  it('uses the installation token, not the App JWT', async () => {
    const { provider, calls } = makeProvider([
      tokenResponse('ghs_scoped'),
      () => json({ repositories: [] }),
    ]);

    await provider.listRepositories(42);

    expect(new Headers(calls[1]?.init.headers).get('authorization')).toBe(
      'Bearer ghs_scoped',
    );
  });

  it('skips records missing the fields it depends on', async () => {
    const { provider } = makeProvider([
      tokenResponse(),
      () =>
        json({
          repositories: [
            { id: 1, full_name: 'acme/ok', private: false },
            { full_name: 'acme/no-id' },
            { id: 3 },
          ],
        }),
    ]);

    expect(await provider.listRepositories(42)).toHaveLength(1);
  });

  it('reports a revoked installation while listing', async () => {
    const { provider } = makeProvider([
      tokenResponse(),
      () => json({ message: 'Not Found' }, 404),
    ]);

    await expect(provider.listRepositories(42)).rejects.toMatchObject({
      reason: 'installation_unavailable',
    });
  });
});
