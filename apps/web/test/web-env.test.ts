import { describe, expect, it } from 'vitest';
import { parseWebEnv } from '../src/lib/web-env';

describe('web environment', () => {
  it('fails in production when API_ORIGIN is missing', () => {
    expect(() => parseWebEnv({ NODE_ENV: 'production' })).toThrow(/API_ORIGIN/);
  });

  it('fails in production when API_ORIGIN is not a URL', () => {
    expect(() => parseWebEnv({ NODE_ENV: 'production', API_ORIGIN: 'api' })).toThrow(/API_ORIGIN/);
  });

  it('normalizes API_ORIGIN to its origin in production', () => {
    const env = parseWebEnv({ NODE_ENV: 'production', API_ORIGIN: 'https://api.argent.test/' });
    expect(env.API_ORIGIN).toBe('https://api.argent.test');
  });

  it('defaults API_ORIGIN to the local API in development', () => {
    expect(parseWebEnv({ NODE_ENV: 'development' }).API_ORIGIN).toBe('http://localhost:4000');
  });

  it('keeps an explicit API_ORIGIN in development', () => {
    expect(
      parseWebEnv({ NODE_ENV: 'development', API_ORIGIN: 'http://127.0.0.1:4100' }).API_ORIGIN,
    ).toBe('http://127.0.0.1:4100');
  });
});
