'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getAnalysisService, refreshRateLimiter } from '@/lib/analysis/container';
import { logger } from '@/lib/logging/logger';
import { parseRepositoryReference } from '@/lib/validation/repository-reference';

export interface SearchState {
  error?: string;
  /** Echoed back so the field keeps its value after a failed submit. */
  value?: string;
}

/**
 * Handles the repository search form.
 *
 * Validation happens here, on the server, before any redirect. The client-side
 * check in the form is a convenience for immediate feedback, not the boundary —
 * this is.
 *
 * The rejected value is echoed back into the field so the user can correct a
 * typo rather than retype the whole thing. It is returned as data and rendered
 * by React as text, never interpolated into markup.
 */
export async function analyzeRepository(
  _previous: SearchState,
  formData: FormData,
): Promise<SearchState> {
  const raw = formData.get('repository');
  const input = typeof raw === 'string' ? raw : '';

  const parsed = parseRepositoryReference(input);

  if (!parsed.ok) {
    return { error: parsed.error, value: input };
  }

  redirect(`/r/${parsed.value.owner}/${parsed.value.name}`);
}

export interface RefreshState {
  error?: string;
}

/**
 * Identifies the caller for rate limiting.
 *
 * Only proxy-set headers are trusted, and only the first entry of
 * `x-forwarded-for` — the rest are appended by intermediaries and are
 * attacker-controlled. Behind no proxy at all every caller shares the
 * `unknown` bucket, which is deliberately conservative: it under-serves a
 * local developer rather than over-serving a real deployment.
 */
async function clientKey(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();

  if (first !== undefined && first !== '') return first;
  return headerList.get('x-real-ip') ?? 'unknown';
}

/** "45 seconds" / "2 minutes", so the message says when rather than how long. */
function describeRetryAfter(seconds: number): string {
  if (seconds < 60) {
    return seconds === 1 ? '1 second' : `${seconds} seconds`;
  }

  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/**
 * Re-runs an analysis, bypassing the cache.
 *
 * Every refresh spends GitHub rate limit, which is why `refreshRateLimiter` is
 * capped far more tightly than ordinary analysis. Exceeding it returns a
 * message naming when to try again rather than failing silently.
 *
 * The repository is read from the form rather than from the URL so the action
 * validates its own input with the same parser as every other entry point,
 * instead of trusting a value the caller supplies.
 */
export async function refreshAnalysis(
  _previous: RefreshState,
  formData: FormData,
): Promise<RefreshState> {
  const raw = formData.get('repository');
  const input = typeof raw === 'string' ? raw : '';

  const parsed = parseRepositoryReference(input);
  if (!parsed.ok) return { error: parsed.error };

  const limit = refreshRateLimiter.check(await clientKey());
  if (!limit.allowed) {
    return {
      error: `Refresh limit reached. Try again in ${describeRetryAfter(limit.retryAfterSeconds)}.`,
    };
  }

  const service = await getAnalysisService();

  try {
    await service.analyze(parsed.value, { forceRefresh: true });
  } catch (error) {
    // The page already renders analysis failures in full; here we only need to
    // say the refresh did not happen, and leave the cached report on screen.
    logger.warn('refresh_failed', {
      repository: `${parsed.value.owner}/${parsed.value.name}`,
      detail: error instanceof Error ? error.message : 'unknown',
    });
    return { error: 'Could not refresh right now. The report below is unchanged.' };
  }

  revalidatePath(`/r/${parsed.value.owner}/${parsed.value.name}`);
  return {};
}
