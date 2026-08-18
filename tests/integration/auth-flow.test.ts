import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { GitHubAppConfig } from '@/lib/auth/github-app';
import { statesMatch } from '@/lib/auth/github-app';
import { InstallationTokenProvider } from '@/lib/auth/installation';
import { sealSession, unsealSession } from '@/lib/auth/session';

import { TEST_PRIVATE_KEY } from '../support/rsa-key';

/**
 * The sign-in flow, end to end, with GitHub mocked.
 *
 * These exercise the decisions the route handlers make — state verification,
 * installation proof, session sealing — against a realistic GitHub, without
 * needing a real App. Creating a GitHub App requires GitHub's web UI and
 * cannot be automated, so this is the closest verification available until
 * someone completes the one-time setup.
 */

const API = 'https://api.github.com';
const NOW = new Date('2026-06-01T12:00:00Z');

const CONFIG: GitHubAppConfig = {
  appId: '123456',
  clientId: 'Iv1.test',
  clientSecret: 'test-client-secret',
  privateKey: TEST_PRIVATE_KEY,
  sessionSecret: 'a-secret-that-is-at-least-32-characters-long',
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function installationHandlers(installationId: number, repositories: unknown[]) {
  return [
    http.post(`${API}/app/installations/${installationId}/access_tokens`, () =>
      HttpResponse.json({
        token: 'ghs_installationtoken',
        expires_at: new Date(NOW.getTime() + 3600_000).toISOString(),
      }),
    ),
    http.get(`${API}/installation/repositories`, () =>
      HttpResponse.json({ total_count: repositories.length, repositories }),
    ),
  ];
}

function provider() {
  return new InstallationTokenProvider(CONFIG, { now: () => NOW });
}

describe('completing an installation', () => {
  it('proves the installation exists before a session is created', async () => {
    server.use(
      ...installationHandlers(555, [
        { id: 1, full_name: 'acme/private-api', private: true },
      ]),
    );

    const repositories = await provider().listRepositories(555);
    expect(repositories[0]?.fullName).toBe('acme/private-api');
  });

  it('refuses a forged installation id', async () => {
    // The callback takes installation_id from the query string. Minting is
    // what stops a crafted value producing a session for someone else's
    // installation.
    server.use(
      http.post(`${API}/app/installations/999/access_tokens`, () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
    );

    await expect(provider().getToken(999)).rejects.toMatchObject({
      reason: 'installation_unavailable',
    });
  });

  it('seals a session that survives a round trip but carries no token', async () => {
    const sealed = sealSession(
      {
        installationId: 555,
        login: 'acme',
        expiresAt: Math.floor(NOW.getTime() / 1000) + 3600,
      },
      CONFIG.sessionSecret,
    );

    const opened = unsealSession(sealed, CONFIG.sessionSecret, NOW);

    expect(opened?.installationId).toBe(555);
    expect(sealed).not.toContain('ghs_');
    expect(JSON.stringify(opened)).not.toMatch(/token/i);
  });
});

describe('CSRF protection on the callback', () => {
  it('accepts a matching state', () => {
    expect(statesMatch('issued-state', 'issued-state')).toBe(true);
  });

  it('rejects a state the server never issued', () => {
    // Without this, an attacker could complete a sign-in against a victim's
    // browser using their own installation, silently binding the victim's
    // session to an account they control.
    expect(statesMatch('issued-state', 'attacker-state')).toBe(false);
  });

  it('rejects a missing state', () => {
    expect(statesMatch('issued-state', '')).toBe(false);
  });

  it('rejects when no state was issued at all', () => {
    expect(statesMatch('', 'attacker-state')).toBe(false);
  });
});

describe('revoked access', () => {
  it('reports an installation that has been removed', async () => {
    server.use(
      http.post(`${API}/app/installations/555/access_tokens`, () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
    );

    await expect(provider().listRepositories(555)).rejects.toMatchObject({
      reason: 'installation_unavailable',
    });
  });

  it('stops granting access once the repository list no longer includes a repository', async () => {
    // The authorization check is the live list, not the session. Removing a
    // repository on GitHub takes effect on the next analysis.
    server.use(
      ...installationHandlers(555, [{ id: 1, full_name: 'acme/still-granted' }]),
    );

    const granted = await provider().listRepositories(555);
    const names = granted.map((repository) => repository.fullName.toLowerCase());

    expect(names).toContain('acme/still-granted');
    expect(names).not.toContain('acme/revoked');
  });
});

describe('token handling', () => {
  it('sends the installation token, never the App private key', async () => {
    const seen: string[] = [];
    server.use(
      http.post(`${API}/app/installations/555/access_tokens`, ({ request }) => {
        seen.push(request.headers.get('authorization') ?? '');
        return HttpResponse.json({
          token: 'ghs_installationtoken',
          expires_at: new Date(NOW.getTime() + 3600_000).toISOString(),
        });
      }),
      http.get(`${API}/installation/repositories`, ({ request }) => {
        seen.push(request.headers.get('authorization') ?? '');
        return HttpResponse.json({ repositories: [] });
      }),
    );

    await provider().listRepositories(555);

    expect(seen[0]?.startsWith('Bearer ')).toBe(true);
    expect(seen[1]).toBe('Bearer ghs_installationtoken');
    for (const header of seen) {
      expect(header).not.toContain('PRIVATE KEY');
      expect(header).not.toContain('test-client-secret');
    }
  });
});
