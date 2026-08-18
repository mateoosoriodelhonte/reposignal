import { randomBytes } from 'node:crypto';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { appConfig } from '@/lib/auth';
import { logger } from '@/lib/logging/logger';

/**
 * Starts sign-in.
 *
 * Issues a single-use `state` in an HttpOnly cookie and sends the user to
 * GitHub to install the App. The callback compares what GitHub returns against
 * that cookie, so a callback the user did not initiate cannot create a session.
 */
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'reposignal_oauth_state';
const STATE_TTL_SECONDS = 600;

export async function GET() {
  const config = appConfig();

  if (config === null) {
    return NextResponse.redirect(
      new URL('/?auth=unavailable', process.env['APP_URL'] ?? 'http://localhost:3000'),
    );
  }

  const state = randomBytes(32).toString('base64url');

  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_TTL_SECONDS,
  });

  logger.info('sign_in_started', {});

  // GitHub resolves the App from the client id and returns to the callback
  // configured in the App itself, so no redirect_uri is trusted from here.
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', config.clientId);
  authorize.searchParams.set('state', state);

  return NextResponse.redirect(authorize);
}

export { STATE_COOKIE, STATE_TTL_SECONDS };
