import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '../src/lib/content-security-policy';

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split(';').map((directive) => {
      const [name = '', ...values] = directive.trim().split(/\s+/);
      return [name, values.join(' ')];
    }),
  );
}

describe('content security policy (R-20)', () => {
  const production = directives(
    contentSecurityPolicy({ nonce: 'abc123', apiOrigin: 'https://api.argent.test', isDev: false }),
  );

  it('allows scripts only through the nonce, never inline', () => {
    expect(production.get('script-src')).toBe(`'self' 'nonce-abc123' 'strict-dynamic'`);
  });

  it('allows inline style attributes but nonce-only style elements', () => {
    expect(production.get('style-src')).toBe(`'self' 'nonce-abc123'`);
    expect(production.get('style-src-attr')).toBe(`'unsafe-inline'`);
  });

  it('lets the web app call the API origin', () => {
    expect(production.get('connect-src')).toBe(`'self' https://api.argent.test`);
  });

  it('forbids framing, plugins and base-uri changes', () => {
    expect(production.get('frame-ancestors')).toBe(`'none'`);
    expect(production.get('object-src')).toBe(`'none'`);
    expect(production.get('base-uri')).toBe(`'self'`);
  });
});
