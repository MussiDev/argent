/**
 * Reads the one-time token of an email link (`?token=...`) and removes it from the address bar
 * and the history entry, so it is not left behind in the browser's history.
 */
export function takeUrlToken(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  if (token !== null) {
    url.searchParams.delete('token');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }
  return token;
}
