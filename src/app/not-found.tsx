import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted mt-3">
        That page does not exist. If you were looking for a repository analysis, the
        address should look like{' '}
        <code className="bg-surface rounded px-1 py-0.5 font-mono text-sm">
          /r/owner/repository
        </code>
        .
      </p>
      <p className="mt-6">
        <Link href="/" className="text-accent underline underline-offset-4">
          Analyze a repository
        </Link>
      </p>
    </div>
  );
}
