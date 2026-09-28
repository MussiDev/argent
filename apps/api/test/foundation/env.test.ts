import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/shared/config/env';
import { productionOverrides, testEnvSource } from '../helpers/test-env';

const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUER = 'https://accounts.google.com';

/** Endpoints of a local OIDC server, as the integration and e2e runs configure them. */
const FAKE_GOOGLE: Record<string, string> = {
  GOOGLE_CLIENT_ID: 'local-client',
  GOOGLE_CLIENT_SECRET: 'local-secret',
  GOOGLE_AUTHORIZATION_URL: 'http://127.0.0.1:4100/authorize',
  GOOGLE_TOKEN_URL: 'http://127.0.0.1:4100/token',
  GOOGLE_JWKS_URL: 'http://127.0.0.1:4100/jwks',
  GOOGLE_ISSUER: 'http://127.0.0.1:4100',
};

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
    const source = testEnvSource(productionOverrides);
    delete source.EMAIL_FROM;
    expect(() => parseEnv(source)).toThrow(/EMAIL_FROM/);
    expect(
      parseEnv(
        testEnvSource({ ...productionOverrides, EMAIL_FROM: 'Argent <no-reply@argent.app>' }),
      ).EMAIL_FROM,
    ).toBe('Argent <no-reply@argent.app>');
  });

  it.each(['development', 'test'])(
    'refuses EMAIL_PROVIDER=resend with NODE_ENV=%s (the SDK prints raw provider errors there)',
    (nodeEnv) => {
      const resend = {
        NODE_ENV: nodeEnv,
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_test',
        EMAIL_FROM: 'Argent <no-reply@argent.app>',
      };
      expect(() => parseEnv(testEnvSource(resend))).toThrow(
        /EMAIL_PROVIDER: resend requires NODE_ENV=production/,
      );
    },
  );

  it('gives console and mailpit a local sender when EMAIL_FROM is unset', () => {
    for (const provider of ['console', 'mailpit']) {
      expect(parseEnv(testEnvSource({ EMAIL_PROVIDER: provider })).EMAIL_FROM).toMatch(/@/);
    }
  });

  it('defaults the Google endpoints to Google and leaves the client unset outside production', () => {
    const env = parseEnv(testEnvSource());

    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
    expect(env.GOOGLE_AUTHORIZATION_URL).toBe(GOOGLE_AUTHORIZATION_URL);
    expect(env.GOOGLE_TOKEN_URL).toBe(GOOGLE_TOKEN_URL);
    expect(env.GOOGLE_JWKS_URL).toBe(GOOGLE_JWKS_URL);
    expect(env.GOOGLE_ISSUER).toBe(GOOGLE_ISSUER);
  });

  it('treats empty GOOGLE_* values as unset (blank lines copied from .env.example)', () => {
    const env = parseEnv(
      testEnvSource({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_TOKEN_URL: '' }),
    );

    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_TOKEN_URL).toBe(GOOGLE_TOKEN_URL);
  });

  it('accepts a local OIDC server for the Google endpoints outside production', () => {
    const env = parseEnv(testEnvSource(FAKE_GOOGLE));

    expect(env.GOOGLE_CLIENT_ID).toBe('local-client');
    expect(env.GOOGLE_TOKEN_URL).toBe('http://127.0.0.1:4100/token');
    expect(env.GOOGLE_ISSUER).toBe('http://127.0.0.1:4100');
  });

  it.each(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])('requires %s in production', (name) => {
    const source = { ...testEnvSource(productionOverrides), [name]: undefined };
    expect(() => parseEnv(source)).toThrow(new RegExp(name));
  });

  it('requires GOOGLE_CLIENT_SECRET whenever GOOGLE_CLIENT_ID is set', () => {
    expect(() => parseEnv(testEnvSource({ GOOGLE_CLIENT_ID: 'local-client' }))).toThrow(
      /GOOGLE_CLIENT_SECRET/,
    );
  });

  it.each(['GOOGLE_AUTHORIZATION_URL', 'GOOGLE_TOKEN_URL', 'GOOGLE_JWKS_URL', 'GOOGLE_ISSUER'])(
    'rejects a non-Google %s in production',
    (name) => {
      expect(parseProduction({ [name]: FAKE_GOOGLE[name] ?? '' })).toThrow(new RegExp(name));
    },
  );

  it('rejects a Google endpoint that is not a URL', () => {
    expect(() => parseEnv(testEnvSource({ GOOGLE_JWKS_URL: 'not a url' }))).toThrow(
      /GOOGLE_JWKS_URL/,
    );
  });
});
