import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

/**
 * Every route renders dynamically.
 *
 * The nonce in the Content Security Policy (see `src/proxy.ts`) is injected
 * during rendering, so a prerendered page would carry a nonce that no longer
 * matches the header its visitor receives, and its scripts would be blocked.
 * Prerendering the homepage is the price of a strict script policy.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: {
    default: 'RepoSignal — GitHub engineering health analysis',
    template: '%s · RepoSignal',
  },
  description:
    'RepoSignal analyzes public GitHub repositories and reports engineering health with transparent, evidence-backed scoring.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="focus:bg-accent focus:text-accent-contrast sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:px-4 focus:py-2"
        >
          Skip to main content
        </a>

        <header className="border-border-subtle border-b">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Repo<span className="text-accent">Signal</span>
            </Link>
            <nav aria-label="Primary">
              <a
                href="https://github.com/mateoosoriodelhonte/reposignal"
                className="text-muted hover:text-foreground text-sm underline underline-offset-4"
                rel="noopener noreferrer"
                target="_blank"
              >
                Source on GitHub
              </a>
            </nav>
          </div>
        </header>

        <main id="main" className="flex-1">
          {children}
        </main>

        <footer className="border-border-subtle border-t">
          <div className="text-muted mx-auto w-full max-w-5xl px-6 py-6 text-sm">
            <p>
              RepoSignal reports observable signals from public GitHub data. Scores
              describe evidence, not code quality, and never imply causation.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
