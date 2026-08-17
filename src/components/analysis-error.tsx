import Link from 'next/link';

import { GitHubError, isRateLimitError } from '@/lib/github/errors';

/**
 * Failure states.
 *
 * Each error class gets its own explanation and its own next step. A generic
 * "something went wrong" tells a user nothing they can act on, and hides
 * whether the problem is theirs, GitHub's, or RepoSignal's.
 *
 * Nothing here exposes a stack trace or an internal detail.
 */

interface ErrorPresentation {
  title: string;
  body: string;
  action?: string;
}

function describe(error: unknown, repository: string): ErrorPresentation {
  if (isRateLimitError(error)) {
    const resetsAt = error.resetAt;
    const when =
      resetsAt === null
        ? 'shortly'
        : resetsAt.toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short',
          });

    return {
      title: 'GitHub rate limit reached',
      body: error.isSecondary
        ? `GitHub is temporarily throttling requests. Access should return around ${when}.`
        : `RepoSignal has used its GitHub API allowance for now. It resets around ${when}.`,
      action: 'Analyses already cached are still available.',
    };
  }

  if (error instanceof GitHubError) {
    switch (error.kind) {
      case 'not_found':
        return {
          title: 'Repository not found',
          body: `GitHub has no public repository at ${repository}. It may be private, renamed, or deleted — RepoSignal only reads public data.`,
          action: 'Check the owner and name, then try again.',
        };
      case 'forbidden':
        return {
          title: 'Repository is not accessible',
          body: `GitHub refused access to ${repository}. This usually means the repository is private or has been made unavailable.`,
          action: 'RepoSignal can only analyze public repositories.',
        };
      case 'timeout':
        return {
          title: 'GitHub did not respond in time',
          body: 'The request to GitHub timed out before the analysis could finish.',
          action: 'Try again in a moment.',
        };
      case 'network':
        return {
          title: 'Could not reach GitHub',
          body: 'RepoSignal could not connect to the GitHub API.',
          action: 'This is usually temporary. Try again shortly.',
        };
      case 'budget_exhausted':
        return {
          title: 'Analysis exceeded its request budget',
          body: `Analyzing ${repository} needed more GitHub requests than one analysis is allowed to spend.`,
          action:
            'This is a limit RepoSignal imposes on itself to stay a good API citizen.',
        };
      default:
        return {
          title: 'GitHub returned an unexpected response',
          body: `Something went wrong while analyzing ${repository}, and RepoSignal could not interpret GitHub's response.`,
          action: 'Try again shortly.',
        };
    }
  }

  return {
    title: 'Analysis could not be completed',
    body: `Something went wrong while analyzing ${repository}.`,
    action: 'Try again shortly.',
  };
}

export function AnalysisError({
  error,
  repository,
}: {
  error: unknown;
  repository: string;
}) {
  const { title, body, action } = describe(error, repository);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16">
      <div className="border-border-subtle bg-surface-raised rounded-lg border p-6">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-muted mt-3">{body}</p>
        {action !== undefined && <p className="text-muted mt-2 text-sm">{action}</p>}

        <p className="mt-6">
          <Link href="/" className="text-accent underline underline-offset-4">
            Analyze a different repository
          </Link>
        </p>
      </div>
    </div>
  );
}

/**
 * Shown when part of the data could not be collected.
 *
 * The analysis that succeeded is still rendered — discarding good partial data
 * because one endpoint failed would serve nobody. The banner names what is
 * missing so the reader can weigh the result accordingly.
 */
export function PartialDataBanner({ limitations }: { limitations: string[] }) {
  if (limitations.length === 0) return null;

  return (
    <aside
      className="border-severity-medium bg-surface rounded-lg border p-4"
      aria-labelledby="partial-data-heading"
    >
      <h2 id="partial-data-heading" className="text-sm font-semibold">
        Some data could not be retrieved
      </h2>
      <p className="text-muted mt-1 text-sm">
        The analysis below is based on what RepoSignal could observe. Anything unavailable
        was excluded from the score rather than counted against the repository.
      </p>
      <ul className="text-muted mt-2 list-disc space-y-1 pl-5 text-sm">
        {limitations.map((limitation) => (
          <li key={limitation}>{limitation}</li>
        ))}
      </ul>
    </aside>
  );
}
