const GMAIL_DOMAIN = 'gmail.com';

/**
 * Whether Google's `email_verified` can be trusted to prove ownership of the address (FR-07).
 * Google documents it as authoritative only for gmail.com and Google Workspace accounts, which
 * carry the `hd` (hosted domain) claim; for any other domain the Google account may merely claim
 * an address somebody else owns now.
 */
export function isGoogleAuthoritative(email: string, hostedDomain: string | null): boolean {
  if (hostedDomain) return true;
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  return domain === GMAIL_DOMAIN;
}
