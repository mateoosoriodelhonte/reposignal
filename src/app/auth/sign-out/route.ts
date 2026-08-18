import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE } from '@/lib/auth';
import { logger } from '@/lib/logging/logger';

/**
 * Ends the session.
 *
 * POST rather than GET so a link or image on another site cannot sign a user
 * out, and so it cannot be triggered by prefetching.
 *
 * This clears RepoSignal's session only. It does not uninstall the App — the
 * UI says so, and links to GitHub where the user can actually revoke access.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  (await cookies()).delete(SESSION_COOKIE);
  logger.info('sign_out', {});
  return NextResponse.redirect(new URL('/', request.url), { status: 303 });
}
