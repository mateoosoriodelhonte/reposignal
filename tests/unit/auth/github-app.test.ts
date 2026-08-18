import { createVerify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  GitHubAppError,
  type GitHubAppConfig,
  installationUrl,
  readAppConfig,
  signAppJwt,
  statesMatch,
} from '@/lib/auth/github-app';

import { TEST_PRIVATE_KEY, TEST_PUBLIC_KEY } from '../../support/rsa-key';

const NOW = new Date('2026-06-01T12:00:00Z');

const CONFIG: GitHubAppConfig = {
  appId: '123456',
  clientId: 'Iv1.testclientid',
  clientSecret: 'test-client-secret',
  privateKey: TEST_PRIVATE_KEY,
  sessionSecret: 'a-secret-that-is-at-least-32-characters-long',
};

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

describe('signAppJwt', () => {
  it('produces a three-part JWT', () => {
    expect(signAppJwt(CONFIG, NOW).split('.')).toHaveLength(3);
  });

  it('declares RS256, which is what GitHub requires', () => {
    const [header] = signAppJwt(CONFIG, NOW).split('.');
    expect(decodeSegment(header ?? '')).toEqual({ alg: 'RS256', typ: 'JWT' });
  });

  it('produces a signature that verifies against the public key', () => {
    // Signing is verified cryptographically rather than by shape, since a
    // malformed signature would be accepted by any structural assertion.
    const jwt = signAppJwt(CONFIG, NOW);
    const [header, payload, signature] = jwt.split('.');

    const verified = createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(TEST_PUBLIC_KEY, signature ?? '', 'base64url');

    expect(verified).toBe(true);
  });

  it('issues the token as the App', () => {
    const [, payload] = signAppJwt(CONFIG, NOW).split('.');
    expect(decodeSegment(payload ?? '')['iss']).toBe('123456');
  });

  it('backdates iat to survive clock drift', () => {
    // GitHub rejects a token issued even slightly in the future.
    const [, payload] = signAppJwt(CONFIG, NOW).split('.');
    const iat = decodeSegment(payload ?? '')['iat'] as number;
    expect(iat).toBe(Math.floor(NOW.getTime() / 1000) - 60);
  });

  it('expires within the ten minutes GitHub allows', () => {
    const [, payload] = signAppJwt(CONFIG, NOW).split('.');
    const claims = decodeSegment(payload ?? '');
    const lifetime = (claims['exp'] as number) - (claims['iat'] as number);
    expect(lifetime).toBeLessThanOrEqual(600);
  });

  it('reports an unreadable private key rather than producing a bad token', () => {
    const broken = { ...CONFIG, privateKey: 'not-a-key' };
    expect(() => signAppJwt(broken, NOW)).toThrow(GitHubAppError);
  });

  it('never embeds the client secret in the token', () => {
    expect(signAppJwt(CONFIG, NOW)).not.toContain('test-client-secret');
  });
});

describe('statesMatch', () => {
  it('accepts an identical state', () => {
    expect(statesMatch('abc123', 'abc123')).toBe(true);
  });

  it.each([
    ['a different value', 'abc123', 'abc124'],
    ['a different length', 'abc123', 'abc1234'],
    ['an empty received value', 'abc123', ''],
    ['an empty expected value', '', 'abc123'],
    ['both empty', '', ''],
  ])('rejects %s', (_label, expected, received) => {
    expect(statesMatch(expected, received)).toBe(false);
  });
});

describe('readAppConfig', () => {
  const full = {
    GITHUB_APP_ID: '123456',
    GITHUB_APP_CLIENT_ID: 'Iv1.test',
    GITHUB_APP_CLIENT_SECRET: 'secret',
    GITHUB_APP_PRIVATE_KEY:
      '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
    SESSION_SECRET: 'a-secret-that-is-at-least-32-characters-long',
  } as unknown as NodeJS.ProcessEnv;

  it('returns null when nothing is configured', () => {
    // Not an error: RepoSignal runs as a public-only analyzer without an App.
    expect(readAppConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('reads a complete configuration', () => {
    const config = readAppConfig(full);
    expect(config?.appId).toBe('123456');
  });

  it('restores newlines in a private key supplied with literal \\n', () => {
    // Multi-line PEMs survive environment variables badly.
    expect(readAppConfig(full)?.privateKey).toContain('\n');
    expect(readAppConfig(full)?.privateKey).not.toContain('\\n');
  });

  it('rejects a partial configuration rather than half-enabling sign-in', () => {
    const partial = { ...full };
    delete partial.SESSION_SECRET;
    expect(() => readAppConfig(partial)).toThrow(/partially configured/i);
  });
});

describe('installationUrl', () => {
  it('points at the App installation page with the state', () => {
    const url = new URL(installationUrl('reposignal', 'state-token'));
    expect(url.origin).toBe('https://github.com');
    expect(url.pathname).toBe('/apps/reposignal/installations/new');
    expect(url.searchParams.get('state')).toBe('state-token');
  });
});
