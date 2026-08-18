'use client';

import { useActionState } from 'react';

import { refreshAnalysis, type RefreshState } from '@/app/actions';

const INITIAL: RefreshState = {};

/**
 * The manual refresh control.
 *
 * A real `<form>` posting to a server action, like the search form, so it works
 * before hydration and with JavaScript disabled — without JS the browser posts
 * the form and the server re-renders the page, which is the whole interaction.
 * `useActionState` only adds the pending state on top of that.
 *
 * The button is a plain `<button type="submit">` rather than anything
 * custom, so it is keyboard operable for free and picks up the global
 * `:focus-visible` ring in `globals.css`.
 *
 * The repository is submitted as a hidden field so the action can validate it
 * with the same parser as every other entry point, rather than trusting the
 * referring URL.
 */
export function RefreshAnalysis({ repository }: { repository: string }) {
  const [state, formAction, pending] = useActionState(refreshAnalysis, INITIAL);
  const errorId = 'refresh-error';

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <form action={formAction} aria-busy={pending}>
        <input type="hidden" name="repository" value={repository} />
        <button
          type="submit"
          disabled={pending}
          aria-describedby={state.error !== undefined ? errorId : undefined}
          className="text-accent underline underline-offset-4 disabled:opacity-60"
        >
          {pending ? 'Refreshing…' : 'Refresh'}
        </button>
      </form>

      {/*
        Always rendered so the live region exists before it has content — a
        region inserted at the same time as its text is not reliably announced.
      */}
      <span id={errorId} role="status" aria-live="polite" className="text-severity-high">
        {pending ? 'Refreshing the analysis…' : (state.error ?? '')}
      </span>
    </span>
  );
}
