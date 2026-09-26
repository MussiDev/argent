import { locale as rootLocale } from 'next/root-params';
import { hasLocale, type AbstractIntlMessages } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ locale: explicitLocale }) => {
  // An explicit locale (e.g. getTranslations({ locale })) wins over the `[locale]` root segment.
  // `rootLocale()` throws in Server Actions and Route Handlers (no root params there), so callers
  // in those contexts must pass `{ locale }` explicitly.
  const requested = explicitLocale ?? (await rootLocale());
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const catalog = (await import(`../../messages/${locale}.json`)) as {
    default: AbstractIntlMessages;
  };

  return { locale, messages: catalog.default };
});
