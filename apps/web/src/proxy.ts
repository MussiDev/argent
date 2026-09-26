import createMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { contentSecurityPolicy } from './lib/content-security-policy';
import { parseWebEnv } from './lib/web-env';

// Parsed when the proxy module loads, so a production server without API_ORIGIN fails at startup.
const env = parseWebEnv(process.env);

const handleI18nRouting = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy({
    nonce,
    apiOrigin: env.API_ORIGIN,
    isDev: env.NODE_ENV === 'development',
  });

  // Next.js reads the nonce from the request's CSP header and applies it to its scripts.
  request.headers.set('x-nonce', nonce);
  request.headers.set('Content-Security-Policy', csp);

  const response = handleI18nRouting(request);
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Every path except API routes, Next.js internals and files with an extension.
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
