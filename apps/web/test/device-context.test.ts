import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDeviceContext } from '../src/lib/device-context';

function stubTimeZone(timeZone: string | undefined): void {
  const resolved = new Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    ...resolved,
    // `undefined` simulates a runtime that reports no time zone (AC-20).
    timeZone: timeZone as string,
  });
}

describe('device context (FR-10, FR-11)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns the browser time zone (AC-19)', () => {
    stubTimeZone('America/Cordoba');
    expect(readDeviceContext().timeZone).toBe('America/Cordoba');
  });

  it('returns the browser language as reported (AC-21)', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    expect(readDeviceContext().language).toBe('en-US');
  });

  it('omits a time zone the device does not report, so the API applies its default (AC-20)', () => {
    stubTimeZone(undefined);
    expect(readDeviceContext().timeZone).toBeUndefined();
  });

  it('omits values longer than the API accepts instead of failing the registration', () => {
    stubTimeZone('X'.repeat(65));
    vi.stubGlobal('navigator', { language: 'x'.repeat(36) });
    expect(readDeviceContext()).toEqual({ timeZone: undefined, language: undefined });
  });

  it('omits the language when there is no navigator', () => {
    vi.stubGlobal('navigator', undefined);
    expect(readDeviceContext().language).toBeUndefined();
  });
});
