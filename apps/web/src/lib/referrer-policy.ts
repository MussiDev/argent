/** Pages whose URL carries a one-time token (`?token=...`) from an email link. */
const TOKEN_PAGES = new Set(['verify-email', 'reset-password']);

/**
 * `no-referrer` for the token pages, so the token never leaks through the Referer header of any
 * request they make; `undefined` keeps the site-wide policy from `next.config.ts`.
 */
export function referrerPolicyFor(pathname: string): 'no-referrer' | undefined {
  const segments = pathname.split('/').filter(Boolean);
  const page = segments.length === 2 ? segments[1] : undefined;
  return page !== undefined && TOKEN_PAGES.has(page) ? 'no-referrer' : undefined;
}
