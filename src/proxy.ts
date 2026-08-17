import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request Content Security Policy with a nonce.
 *
 * Next.js streams Suspense boundaries by flushing inline `<script>` tags, so a
 * policy of `script-src 'self'` silently breaks streaming: the HTML is correct
 * but the browser refuses to run the scripts that swap a fallback for its
 * content, and the page sits on its loading state forever. That bug is only
 * visible in a real browser, which is why it survived until one was pointed at
 * the app.
 *
 * The alternatives were `'unsafe-inline'`, which defeats most of the point of
 * having a script CSP, or a per-request nonce. This takes the nonce.
 *
 * The cost is real and worth stating: nonces are injected during rendering, so
 * every page must render dynamically. RepoSignal gives up prerendering its
 * homepage to get a strict script policy. For an application whose entire
 * subject is engineering diligence, that is the right side of the trade.
 *
 * `style-src` keeps `'unsafe-inline'`: inline *style attributes* are used for
 * the score bars, and CSP has no nonce mechanism for attributes. Inline styles
 * are a far weaker vector than inline scripts.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';

  const csp = [
    "default-src 'self'",
    // `strict-dynamic` lets the nonced bootstrap script load the rest of the
    // bundle, so no host allowlist is needed. `unsafe-eval` is required only in
    // development, where React uses eval to rebuild server stack traces.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://avatars.githubusercontent.com",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);

  return response;
}

export const config = {
  matcher: [
    {
      // Static assets and prefetches need no policy of their own.
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
