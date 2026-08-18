import { createPrivateKey, createSign, timingSafeEqual } from 'node:crypto';

/**
 * GitHub App credentials.
 *
 * A GitHub App authenticates in two steps. First the App proves it is itself
 * with a short-lived JWT signed by its private key. Then it exchanges that JWT
 * for an *installation access token*, which is scoped to the repositories one
 * user actually granted and expires in an hour.
 *
 * The second token is the one used for analysis. It cannot read a repository
 * the user did not select, and it dies on its own — which is why nothing here
 * is ever persisted.
 */

export interface GitHubAppConfig {
  appId: string;
  clientId: string;
  clientSecret: string;
  /** PEM-encoded RSA private key from the App settings. */
  privateKey: string;
  /** Cookie/session encryption secret. */
  sessionSecret: string;
}

export class GitHubAppError extends Error {
  constructor(
    message: string,
    readonly reason:
      'not_configured' | 'invalid_key' | 'exchange_failed' | 'installation_unavailable',
  ) {
    super(message);
    this.name = 'GitHubAppError';
  }
}

/**
 * Reads App configuration from the environment.
 *
 * Returns `null` when the App is not configured, which is a supported state:
 * RepoSignal runs as a public-only analyzer and simply does not offer sign-in.
 * Partial configuration is an error rather than a silent half-feature.
 */
export function readAppConfig(
  env: NodeJS.ProcessEnv = process.env,
): GitHubAppConfig | null {
  const appId = env['GITHUB_APP_ID'];
  const clientId = env['GITHUB_APP_CLIENT_ID'];
  const clientSecret = env['GITHUB_APP_CLIENT_SECRET'];
  const sessionSecret = env['SESSION_SECRET'];
  // Newlines survive an env var badly, so the key is accepted with literal \n.
  const privateKey = env['GITHUB_APP_PRIVATE_KEY']?.replace(/\\n/g, '\n');

  const present = [appId, clientId, clientSecret, privateKey, sessionSecret].filter(
    (value) => value !== undefined && value !== '',
  ).length;

  if (present === 0) return null;

  if (
    appId === undefined ||
    clientId === undefined ||
    clientSecret === undefined ||
    privateKey === undefined ||
    sessionSecret === undefined ||
    present < 5
  ) {
    throw new GitHubAppError(
      'GitHub App is partially configured. Set all of GITHUB_APP_ID, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, GITHUB_APP_PRIVATE_KEY, and SESSION_SECRET, or none of them.',
      'not_configured',
    );
  }

  return { appId, clientId, clientSecret, privateKey, sessionSecret };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Signs the App-level JWT.
 *
 * RS256 with the App private key, per GitHub's requirement. Implemented on
 * `node:crypto` rather than pulling in a JWT library: this is one specific
 * token with one algorithm, and a dependency that can verify arbitrary tokens
 * is a larger surface than the twenty lines it replaces.
 *
 * `iat` is backdated 60 seconds because GitHub rejects tokens whose issue time
 * is in the future by even a little, and clocks drift.
 */
export function signAppJwt(config: GitHubAppConfig, now: Date): string {
  const issuedAt = Math.floor(now.getTime() / 1000) - 60;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iat: issuedAt,
      // GitHub rejects anything beyond ten minutes.
      exp: issuedAt + 540,
      iss: config.appId,
    }),
  );

  const signingInput = `${header}.${payload}`;

  let signature: string;
  try {
    const key = createPrivateKey(config.privateKey);
    signature = createSign('RSA-SHA256').update(signingInput).sign(key, 'base64url');
  } catch {
    throw new GitHubAppError(
      'The configured GitHub App private key could not be read.',
      'invalid_key',
    );
  }

  return `${signingInput}.${signature}`;
}

/**
 * Constant-time comparison for the OAuth `state` parameter.
 *
 * The callback compares an attacker-influenced value against one RepoSignal
 * issued, which is exactly the shape that leaks information through timing.
 */
export function statesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** Where GitHub sends the user to install the App. */
export function installationUrl(appSlug: string, state: string): string {
  const url = new URL(`https://github.com/apps/${appSlug}/installations/new`);
  url.searchParams.set('state', state);
  return url.toString();
}
