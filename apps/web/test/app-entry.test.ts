import { afterEach, describe, expect, it, vi } from 'vitest';
import es from '../messages/es.json';
import manifest from '../src/app/manifest';
import { register } from '../src/instrumentation';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('web app manifest', () => {
  it('installs the PWA in the default locale with the catalog name', () => {
    expect(manifest()).toEqual({
      name: es.metadata.title,
      short_name: es.metadata.title,
      description: es.metadata.description,
      lang: 'es',
      start_url: '/es',
      scope: '/',
      display: 'standalone',
    });
  });
});

describe('instrumentation', () => {
  it('stops a production server without API_ORIGIN before any request', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('API_ORIGIN', '');

    expect(() => {
      register();
    }).toThrow(/API_ORIGIN/);
  });

  it('starts with a valid environment', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('API_ORIGIN', 'https://api.argent.test');

    expect(() => {
      register();
    }).not.toThrow();
  });
});
