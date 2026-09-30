import { describe, expect, it } from 'vitest';
import { parseWorkerEnv } from '../../src/shared/config/env';

/** Exactly the seven settings the email worker reads, as a production service would set them. */
const WORKER_PRODUCTION = {
  NODE_ENV: 'production',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgres://worker:worker-db-password@db.internal:5432/app',
  WEB_BASE_URL: 'https://app.example.com',
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_worker_test_key_0123456789',
  EMAIL_FROM: 'App <no-reply@example.com>',
};

function parseProduction(overrides: Record<string, string | undefined>) {
  return () => parseWorkerEnv({ ...WORKER_PRODUCTION, ...overrides });
}

describe('worker environment', () => {
  it('accepts production with only its seven settings, without JWT_SECRET or Google settings', () => {
    const env = parseWorkerEnv(WORKER_PRODUCTION);

    expect(env.NODE_ENV).toBe('production');
    expect(env.WEB_BASE_URL).toBe('https://app.example.com');
    expect(env.EMAIL_FROM).toBe('App <no-reply@example.com>');
    expect(env).not.toHaveProperty('JWT_SECRET');
    expect(env).not.toHaveProperty('GOOGLE_CLIENT_ID');
  });

  it('invalid WEB_BASE_URL error: refuses http links in production', () => {
    expect(parseProduction({ WEB_BASE_URL: 'http://app.example.com' })).toThrow(/WEB_BASE_URL/);
  });

  it('invalid EMAIL_PROVIDER error: requires resend in production', () => {
    expect(parseProduction({ EMAIL_PROVIDER: 'console' })).toThrow(/EMAIL_PROVIDER/);
  });

  it('missing DATABASE_URL error: names the variable without printing any value', () => {
    let message = '';
    try {
      parseWorkerEnv({ ...WORKER_PRODUCTION, DATABASE_URL: undefined });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/DATABASE_URL/);
    for (const value of Object.values(WORKER_PRODUCTION)) {
      expect(message).not.toContain(value);
    }
  });

  it('missing Resend settings error: names RESEND_API_KEY and EMAIL_FROM', () => {
    expect(parseProduction({ RESEND_API_KEY: undefined })).toThrow(/RESEND_API_KEY/);
    expect(parseProduction({ EMAIL_FROM: undefined })).toThrow(/EMAIL_FROM/);
  });

  it('refuses resend outside production', () => {
    expect(parseProduction({ NODE_ENV: 'development' })).toThrow(/EMAIL_PROVIDER/);
  });

  it('gives console and mailpit a local sender when EMAIL_FROM is unset', () => {
    const env = parseWorkerEnv({
      DATABASE_URL: WORKER_PRODUCTION.DATABASE_URL,
      WEB_BASE_URL: 'http://localhost:3000',
      EMAIL_PROVIDER: 'mailpit',
    });

    expect(env.NODE_ENV).toBe('development');
    expect(env.EMAIL_FROM).toMatch(/no-reply@/);
  });
});
