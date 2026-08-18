import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  appConfig,
  sealSession,
  SESSION_COOKIE,
  sessionCookieOptions,
  tokenProvider,
} from '@/lib/auth';
import { statesMatch } from '@/lib/auth/github-app';
import { logger } from '@/lib/logging/logger';

import { STATE_COOKIE } from '../sign-in/route';

/**
 * Completes sign-in.
 *
 * GitHub sends the user here after they install the App. Three things have to
 * hold before a session is created:
 *
 * 1. The `state` matches the one issued, compared in constant time. This is
 *    the CSRF defence — without it, an attacker could complete a sign-in flow
 *    against a victim's browser using their own installation.
 * 2. An `installation_id` is present and numeric.
 * 3. That installation actually mints a token, proving it exists and that this
 *    App may use it. A crafted `installation_id` fails here.
 *
 * The session that results holds the installation id and a display name.
 * No token is stored in it — tokens are minted per use and never persisted.
 */
export const dynamic = 'force-dynamic';

const SESSION_TTL_SECONDS = 8 * 60 * 60;

function failure(request: Request, reason: string) {
  logger.warn('sign_in_failed', { reason });
  return NextResponse.redirect(new URL(`/?auth=failed`, request.url), { status: 303 });
}

export async function GET(request: Request) {
  const config = appConfig();
  const provider = tokenProvider();

  if (config === null || provider === null) {
    return failure(request, 'not_configured');
  }

  const url = new URL(request.url);
  const returnedState = url.searchParams.get('state') ?? '';
  const installationParam = url.searchParams.get('installation_id');

  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value ?? '';

  // Single use: consumed whether or not it matches, so a state cannot be
  // replayed against a second attempt.
  jar.delete(STATE_COOKIE);

  if (!statesMatch(expectedState, returnedState)) {
    return failure(request, 'state_mismatch');
  }

  const installationId = Number(installationParam);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    return failure(request, 'missing_installation');
  }

  // Proves the installation exists and belongs to this App. A forged id cannot
  // survive this, which is what stops a crafted callback minting a session for
  // someone else's installation.
  let login = 'your account';
  try {
    await provider.getToken(installationId);
    const repositories = await provider.listRepositories(installationId);
    login = repositories[0]?.fullName.split('/')[0] ?? login;
  } catch {
    return failure(request, 'installation_unavailable');
  }

  const session = sealSession(
    {
      installationId,
      login,
      expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    },
    config.sessionSecret,
  );

  jar.set(SESSION_COOKIE, session, sessionCookieOptions(SESSION_TTL_SECONDS));
  logger.info('sign_in_completed', { installationId });

  return NextResponse.redirect(new URL('/repositories', request.url), { status: 303 });
}
