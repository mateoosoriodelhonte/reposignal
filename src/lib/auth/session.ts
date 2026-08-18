import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Encrypted session sealing.
 *
 * The session travels in a cookie, so it is authenticated encryption rather
 * than a signature: AES-256-GCM gives confidentiality and integrity in one
 * step, and a tampered payload fails to decrypt rather than merely failing a
 * comparison.
 *
 * What is deliberately *not* in here: any GitHub token. The session carries an
 * installation id, and an installation access token is minted server-side when
 * one is needed. A stolen cookie therefore grants nothing that outlives the
 * user revoking the installation, and no long-lived credential ever leaves the
 * server.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SALT = 'reposignal.session.v1';

export interface SessionData {
  /** GitHub App installation the user completed. */
  installationId: number;
  /** Login of the account that installed it, for display only. */
  login: string;
  /** Seconds since the epoch. Checked on every read. */
  expiresAt: number;
}

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

/**
 * Derives a 32-byte key from the configured secret.
 *
 * scrypt rather than a raw hash: the secret is operator-supplied and may be
 * lower entropy than a generated key, and scrypt makes brute-forcing it
 * expensive rather than free.
 */
function deriveKey(secret: string): Buffer {
  if (secret.length < 32) {
    throw new SessionError('SESSION_SECRET must be at least 32 characters.');
  }
  return scryptSync(secret, SALT, 32);
}

/** Encrypts a session into an opaque, URL-safe string. */
export function sealSession(data: SessionData, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

/**
 * Decrypts a sealed session.
 *
 * Returns `null` for anything that is not a valid, unexpired session — a
 * tampered payload, a payload sealed with a different secret, a truncated
 * cookie, or an expired one. Callers treat all of those identically: signed
 * out. Distinguishing them in the response would tell an attacker which of
 * their guesses was closer.
 */
export function unsealSession(
  sealed: string,
  secret: string,
  now: Date,
): SessionData | null {
  let key: Buffer;
  try {
    key = deriveKey(secret);
  } catch {
    return null;
  }

  try {
    const raw = Buffer.from(sealed, 'base64url');
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;

    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const encrypted = raw.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const parsed: unknown = JSON.parse(plaintext.toString('utf8'));

    if (!isSessionData(parsed)) return null;
    if (parsed.expiresAt * 1000 <= now.getTime()) return null;

    return parsed;
  } catch {
    // Any failure — bad tag, bad base64, malformed JSON — is "signed out".
    return null;
  }
}

function isSessionData(value: unknown): value is SessionData {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['installationId'] === 'number' &&
    typeof candidate['login'] === 'string' &&
    typeof candidate['expiresAt'] === 'number'
  );
}

/** The cookie name, and the attributes every session cookie must carry. */
export const SESSION_COOKIE = 'reposignal_session';

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
