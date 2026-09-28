import { describe, expect, it } from 'vitest';
import { referrerPolicyFor } from '../src/lib/referrer-policy';

describe('referrer policy of token pages', () => {
  it.each(['/es/verify-email', '/en/verify-email', '/es/reset-password', '/en/reset-password/'])(
    '%s never sends its URL (with the token) as a referrer',
    (pathname) => {
      expect(referrerPolicyFor(pathname)).toBe('no-referrer');
    },
  );

  it.each(['/es', '/es/sign-in', '/en/register', '/es/verify-email-help', '/verify-email'])(
    '%s keeps the default policy',
    (pathname) => {
      expect(referrerPolicyFor(pathname)).toBeUndefined();
    },
  );
});
