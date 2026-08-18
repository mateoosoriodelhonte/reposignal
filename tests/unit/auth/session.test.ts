import { describe, expect, it } from 'vitest';

import {
  SESSION_COOKIE,
  type SessionData,
  sealSession,
  sessionCookieOptions,
  unsealSession,
} from '@/lib/auth/session';

const SECRET = 'a-secret-that-is-at-least-32-characters-long';
const OTHER_SECRET = 'a-different-secret-also-32-characters-long!!';
const NOW = new Date('2026-06-01T12:00:00Z');

function session(overrides: Partial<SessionData> = {}): SessionData {
  return {
    installationId: 12345,
    login: 'acme',
    expiresAt: Math.floor(NOW.getTime() / 1000) + 3600,
    ...overrides,
  };
}

describe('sealSession / unsealSession', () => {
  it('round-trips a session', () => {
    const sealed = sealSession(session(), SECRET);
    expect(unsealSession(sealed, SECRET, NOW)).toEqual(session());
  });

  it('produces an opaque value that does not leak its contents', () => {
    const sealed = sealSession(session({ login: 'acme-corp' }), SECRET);
    expect(sealed).not.toContain('acme-corp');
    expect(sealed).not.toContain('12345');
  });

  it('produces a different ciphertext each time, so cookies are not comparable', () => {
    // A fresh IV per seal. Identical sessions must not produce identical
    // cookies, or an observer could tell two users hold the same session.
    const first = sealSession(session(), SECRET);
    const second = sealSession(session(), SECRET);
    expect(first).not.toBe(second);
    expect(unsealSession(first, SECRET, NOW)).toEqual(unsealSession(second, SECRET, NOW));
  });

  it('rejects a session sealed with a different secret', () => {
    const sealed = sealSession(session(), OTHER_SECRET);
    expect(unsealSession(sealed, SECRET, NOW)).toBeNull();
  });

  it('rejects a tampered payload rather than trusting it', () => {
    // AES-GCM authenticates as well as encrypts, so flipping any byte fails
    // the tag check rather than decrypting to something plausible.
    const sealed = sealSession(session(), SECRET);
    const raw = Buffer.from(sealed, 'base64url');
    const last = raw.length - 1;
    raw[last] = (raw[last] ?? 0) ^ 0xff;

    expect(unsealSession(raw.toString('base64url'), SECRET, NOW)).toBeNull();
  });

  it('rejects an expired session', () => {
    const sealed = sealSession(
      session({ expiresAt: Math.floor(NOW.getTime() / 1000) - 1 }),
      SECRET,
    );
    expect(unsealSession(sealed, SECRET, NOW)).toBeNull();
  });

  it('accepts a session that has not quite expired', () => {
    const sealed = sealSession(
      session({ expiresAt: Math.floor(NOW.getTime() / 1000) + 1 }),
      SECRET,
    );
    expect(unsealSession(sealed, SECRET, NOW)).not.toBeNull();
  });

  it.each([
    ['empty', ''],
    ['not base64', '!!!not-base64!!!'],
    ['too short to contain an IV and tag', 'AAAA'],
    ['random bytes', Buffer.from('x'.repeat(64)).toString('base64url')],
  ])('returns null for a %s cookie', (_label, value) => {
    expect(unsealSession(value, SECRET, NOW)).toBeNull();
  });

  it('refuses to seal with a secret that is too short to be safe', () => {
    expect(() => sealSession(session(), 'too-short')).toThrow(/at least 32/);
  });

  it('treats a too-short secret as signed out rather than throwing on read', () => {
    // A misconfigured deployment should log people out, not 500 on every page.
    expect(unsealSession('anything', 'too-short', NOW)).toBeNull();
  });

  it('does not carry a GitHub token in the session at all', () => {
    // The session holds an installation id; tokens are minted server-side.
    // A stolen cookie must not be a stolen credential.
    const data = session();
    expect(Object.keys(data)).toEqual(['installationId', 'login', 'expiresAt']);
    expect(JSON.stringify(data)).not.toMatch(/token/i);
  });
});

describe('sessionCookieOptions', () => {
  it('is HttpOnly and SameSite=Lax', () => {
    const options = sessionCookieOptions(3600);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBe(3600);
  });

  it('names the cookie consistently', () => {
    expect(SESSION_COOKIE).toBe('reposignal_session');
  });
});
