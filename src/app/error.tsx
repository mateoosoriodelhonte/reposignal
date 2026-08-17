'use client';

import Link from 'next/link';

/**
 * Route-level error boundary.
 *
 * Renders a safe message only. `error.message` is deliberately not shown — in
 * production Next.js replaces it with a digest anyway, and displaying raw error
 * text is how internal details leak into a page.
 */
export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted mt-3">
        RepoSignal could not finish rendering this page. The failure has been logged.
      </p>

      <div className="mt-6 flex flex-wrap gap-4">
        <button
          type="button"
          onClick={reset}
          className="bg-accent text-accent-contrast rounded-md px-4 py-2 font-medium"
        >
          Try again
        </button>
        <Link href="/" className="text-accent self-center underline underline-offset-4">
          Back to the homepage
        </Link>
      </div>
    </div>
  );
}
