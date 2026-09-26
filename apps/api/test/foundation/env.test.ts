import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/shared/config/env';
import { productionOverrides, testEnvSource } from '../helpers/test-env';

function parseProduction(overrides: Record<string, string>) {
  return () => parseEnv(testEnvSource({ ...productionOverrides, ...overrides }));
}

describe('environment production rules', () => {
  it('accepts a production environment that satisfies every rule', () => {
    const env = parseEnv(testEnvSource(productionOverrides));

    expect(env.NODE_ENV).toBe('production');
    expect(env.TRUST_PROXY).toBe(1);
  });

  it('keeps development and test permissive (console email, fake breach checker, http, no proxy)', () => {
    expect(() => parseEnv(testEnvSource())).not.toThrow();
  });

  it('requires EMAIL_PROVIDER=resend in production', () => {
    expect(parseProduction({ EMAIL_PROVIDER: 'console' })).toThrow(/EMAIL_PROVIDER/);
    expect(parseProduction({ EMAIL_PROVIDER: 'mailpit' })).toThrow(/EMAIL_PROVIDER/);
  });

  it('requires BREACH_CHECKER=hibp in production', () => {
    expect(parseProduction({ BREACH_CHECKER: 'fake' })).toThrow(/BREACH_CHECKER/);
  });

  it.each(['WEB_ORIGIN', 'API_ORIGIN', 'WEB_BASE_URL'])(
    'requires an https: %s in production',
    (name) => {
      expect(parseProduction({ [name]: 'http://argent.test' })).toThrow(new RegExp(name));
    },
  );

  it('requires TRUST_PROXY >= 1 in production', () => {
    expect(parseProduction({ TRUST_PROXY: '0' })).toThrow(/TRUST_PROXY/);
  });

  it('rejects the placeholder JWT_SECRET from .env.example in production', () => {
    expect(
      parseProduction({ JWT_SECRET: 'change-me-to-a-long-random-secret-of-at-least-32-bytes' }),
    ).toThrow(/JWT_SECRET/);
  });

  it('allows the placeholder JWT_SECRET outside production', () => {
    expect(() =>
      parseEnv(
        testEnvSource({ JWT_SECRET: 'change-me-to-a-long-random-secret-of-at-least-32-bytes' }),
      ),
    ).not.toThrow();
  });

  it('requires EMAIL_PROVIDER to be set explicitly (no default)', () => {
    const source = testEnvSource();
    delete source.EMAIL_PROVIDER;
    expect(() => parseEnv(source)).toThrow(/EMAIL_PROVIDER/);
  });

  it('requires EMAIL_FROM when EMAIL_PROVIDER=resend', () => {
    const resend = { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test' };
    expect(() => parseEnv(testEnvSource(resend))).toThrow(/EMAIL_FROM/);
    expect(
      parseEnv(testEnvSource({ ...resend, EMAIL_FROM: 'Argent <no-reply@argent.app>' })).EMAIL_FROM,
    ).toBe('Argent <no-reply@argent.app>');
  });

  it('gives console and mailpit a local sender when EMAIL_FROM is unset', () => {
    for (const provider of ['console', 'mailpit']) {
      expect(parseEnv(testEnvSource({ EMAIL_PROVIDER: provider })).EMAIL_FROM).toMatch(/@/);
    }
  });
});
