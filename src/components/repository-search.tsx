'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { analyzeRepository, type SearchState } from '@/app/actions';

const EXAMPLES = [
  { label: 'facebook/react', href: '/r/facebook/react' },
  { label: 'vercel/next.js', href: '/r/vercel/next.js' },
  { label: 'prisma/prisma', href: '/r/prisma/prisma' },
];

const INITIAL: SearchState = {};

/**
 * The repository input.
 *
 * A real `<form>` posting to a server action, so it works before hydration and
 * with JavaScript disabled. The error is wired to the input with
 * `aria-describedby` and announced through a live region, so a screen reader
 * user learns about a rejected value without having to go looking for it.
 */
export function RepositorySearch() {
  const [state, formAction, pending] = useActionState(analyzeRepository, INITIAL);
  const errorId = 'repository-error';

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="repository" className="sr-only">
            GitHub repository, as owner/name or a GitHub URL
          </label>
          <input
            id="repository"
            name="repository"
            type="text"
            autoComplete="off"
            spellCheck={false}
            defaultValue={state.value ?? ''}
            placeholder="owner/repository"
            aria-invalid={state.error !== undefined}
            aria-describedby={state.error !== undefined ? errorId : undefined}
            className="border-border-strong bg-surface-raised placeholder:text-muted w-full rounded-md border px-4 py-3 text-base"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="bg-accent text-accent-contrast rounded-md px-6 py-3 font-medium disabled:opacity-60"
        >
          {pending ? 'Analyzing…' : 'Analyze'}
        </button>
      </form>

      {/* Always rendered so the live region exists before it has content. */}
      <p
        id={errorId}
        role="status"
        aria-live="polite"
        className="text-severity-high text-sm"
      >
        {state.error ?? ''}
      </p>

      <p className="text-muted text-sm">
        Examples:{' '}
        {EXAMPLES.map((example, index) => (
          <span key={example.href}>
            {index > 0 && ', '}
            <Link
              href={example.href}
              className="text-accent underline underline-offset-4"
            >
              {example.label}
            </Link>
          </span>
        ))}
      </p>
    </div>
  );
}
