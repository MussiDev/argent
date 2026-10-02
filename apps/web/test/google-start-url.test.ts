import { googleStartQuerySchema } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import { buildGoogleStartUrl } from '../src/features/auth/google-start-url';

describe('buildGoogleStartUrl', () => {
  it('includes the device time zone and the active locale (FR-01)', () => {
    const url = new URL(
      buildGoogleStartUrl('http://api.argent.test', 'en', {
        timeZone: 'America/Cordoba',
        language: 'es-AR',
      }),
    );

    expect(url.origin).toBe('http://api.argent.test');
    expect(url.pathname).toBe('/auth/google/start');
    // The screen's locale, not the browser's language: the account opens in what the user sees.
    expect(Object.fromEntries(url.searchParams)).toEqual({
      timeZone: 'America/Cordoba',
      language: 'en',
    });
    expect(googleStartQuerySchema.safeParse(Object.fromEntries(url.searchParams)).success).toBe(
      true,
    );
  });

  it('omits a time zone the device does not report, so the API applies its default', () => {
    const url = new URL(
      buildGoogleStartUrl('http://api.argent.test', 'es', {
        timeZone: undefined,
        language: undefined,
      }),
    );

    expect(url.searchParams.has('timeZone')).toBe(false);
    expect(url.searchParams.get('language')).toBe('es');
  });

  it('does not duplicate the slash of an origin configured with a trailing one', () => {
    expect(
      buildGoogleStartUrl('https://api.argent.test/', 'es', {
        timeZone: undefined,
        language: undefined,
      }),
    ).toBe('https://api.argent.test/auth/google/start?language=es');
  });
});
