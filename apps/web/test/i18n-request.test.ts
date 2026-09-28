import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';

const rootParams = vi.hoisted(() => ({ locale: vi.fn<() => Promise<string | undefined>>() }));

// `next/root-params` is a placeholder the Next.js compiler replaces; this stands in for it.
vi.mock('next/root-params', () => rootParams);
// Outside React Server Components next-intl ships a stub; the server build returns the callback.
vi.mock('next-intl/server', () => ({
  getRequestConfig: <T>(createConfig: T) => createConfig,
}));

const { default: requestConfig } = await import('../src/i18n/request');

type RequestConfigParams = Parameters<typeof requestConfig>[0];

function params(locale: string | undefined): RequestConfigParams {
  return { locale, requestLocale: Promise.resolve(undefined) };
}

describe('i18n request config', () => {
  beforeEach(() => {
    rootParams.locale.mockReset();
  });

  it('uses the `[locale]` segment and its catalog', async () => {
    rootParams.locale.mockResolvedValue('en');

    const config = await requestConfig(params(undefined));

    expect(config).toEqual({ locale: 'en', messages: en });
  });

  it('lets an explicit locale win over the segment', async () => {
    rootParams.locale.mockResolvedValue('en');

    const config = await requestConfig(params('es'));

    expect(config).toEqual({ locale: 'es', messages: es });
    expect(rootParams.locale).not.toHaveBeenCalled();
  });

  it('falls back to the default locale for an unsupported one', async () => {
    rootParams.locale.mockResolvedValue('fr');

    const config = await requestConfig(params(undefined));

    expect(config).toEqual({ locale: 'es', messages: es });
  });
});
