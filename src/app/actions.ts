'use server';

import { redirect } from 'next/navigation';

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
