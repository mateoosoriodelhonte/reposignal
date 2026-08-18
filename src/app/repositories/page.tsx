import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { currentSession, tokenProvider, type InstallationRepository } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your repositories',
  description: 'Repositories you have granted RepoSignal access to analyze.',
};

/**
 * The repository picker.
 *
 * The list comes from GitHub's installation endpoint rather than from anything
 * the client sends, so it is the authoritative answer to "what may RepoSignal
 * see?". A repository absent from this list cannot be analyzed privately, no
 * matter what URL is typed.
 */
export default async function RepositoriesPage() {
  const session = await currentSession();
  if (session === null) redirect('/');

  const provider = tokenProvider();
  if (provider === null) redirect('/');

  let repositories: InstallationRepository[] = [];
  let failed = false;

  try {
    repositories = await provider.listRepositories(session.installationId);
  } catch {
    failed = true;
  }

  const privateCount = repositories.filter((repository) => repository.isPrivate).length;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Your repositories</h1>

      <p className="text-muted mt-2">
        {failed
          ? 'RepoSignal could not read your installation. It may have been removed on GitHub.'
          : `RepoSignal can see ${repositories.length} repositor${
              repositories.length === 1 ? 'y' : 'ies'
            }${privateCount > 0 ? `, ${privateCount} of them private` : ''}.`}
      </p>

      <div className="border-border-subtle bg-surface mt-6 rounded-lg border p-4 text-sm">
        <h2 className="font-medium">What RepoSignal can and cannot do</h2>
        <ul className="text-muted mt-2 list-disc space-y-1 pl-5">
          <li>It reads metadata only — it never clones or executes your code.</li>
          <li>It has read-only access, and cannot write to any repository.</li>
          <li>
            It can only see repositories you selected when installing. Nothing else in
            your account is visible to it.
          </li>
          <li>
            Analyses of private repositories are never written to the shared cache, so
            they are not readable by anyone else.
          </li>
        </ul>
        <p className="mt-3">
          <a
            className="text-accent underline underline-offset-4"
            href="https://github.com/settings/installations"
            rel="noopener noreferrer"
            target="_blank"
          >
            Change or revoke access on GitHub
          </a>
        </p>
      </div>

      {repositories.length === 0 && !failed ? (
        <p className="text-muted mt-8 text-sm">
          The installation does not grant access to any repository yet. Add one from{' '}
          <a
            className="text-accent underline underline-offset-4"
            href="https://github.com/settings/installations"
            rel="noopener noreferrer"
            target="_blank"
          >
            your GitHub installation settings
          </a>
          .
        </p>
      ) : (
        <ul className="mt-8 flex flex-col gap-2">
          {repositories.map((repository) => (
            <li
              key={repository.githubId}
              className="border-border-subtle bg-surface-raised flex items-center justify-between gap-4 rounded-lg border px-4 py-3"
            >
              <span className="min-w-0 truncate">
                {repository.fullName}
                {repository.isPrivate && (
                  <span className="border-border-subtle text-muted ml-2 rounded border px-1.5 py-0.5 text-xs">
                    Private
                  </span>
                )}
              </span>
              <Link
                className="text-accent shrink-0 text-sm underline underline-offset-4"
                href={`/r/${repository.fullName}`}
              >
                Analyze
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
