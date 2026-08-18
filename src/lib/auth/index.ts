import 'server-only';

import { cookies } from 'next/headers';

import { logger } from '@/lib/logging/logger';

import { GitHubAppError, readAppConfig, type GitHubAppConfig } from './github-app';
import { InstallationTokenProvider } from './installation';
import { SESSION_COOKIE, unsealSession, type SessionData } from './session';

/**
 * Auth wiring.
 *
 * `server-only` makes importing any of this from a client component a build
 * error, which is what keeps App credentials out of the browser bundle.
 */

let cachedConfig: GitHubAppConfig | null | undefined;
let cachedProvider: InstallationTokenProvider | undefined;

/** The App config, or null when sign-in is not configured. */
export function appConfig(): GitHubAppConfig | null {
  if (cachedConfig === undefined) {
    try {
      cachedConfig = readAppConfig();
    } catch (error) {
      // A partial configuration is an operator error worth surfacing loudly in
      // logs, but it must not take the public analyzer down with it.
      logger.error('sign_in_failed', {
        reason: error instanceof GitHubAppError ? error.reason : 'not_configured',
      });
      cachedConfig = null;
    }
  }
  return cachedConfig;
}

export function signInEnabled(): boolean {
  return appConfig() !== null;
}

export function tokenProvider(): InstallationTokenProvider | null {
  const config = appConfig();
  if (config === null) return null;

  cachedProvider ??= new InstallationTokenProvider(config, { logger });
  return cachedProvider;
}

/** The current session, or null when signed out or the cookie is unusable. */
export async function currentSession(): Promise<SessionData | null> {
  const config = appConfig();
  if (config === null) return null;

  const sealed = (await cookies()).get(SESSION_COOKIE)?.value;
  if (sealed === undefined) return null;

  return unsealSession(sealed, config.sessionSecret, new Date());
}

export { GitHubAppError } from './github-app';
export { SESSION_COOKIE, sealSession, sessionCookieOptions } from './session';
export type { SessionData } from './session';
export type { InstallationRepository } from './installation';
