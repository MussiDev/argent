import { readFileSync } from 'node:fs';
import type esCatalog from '../../messages/es.json';

type Catalog = typeof esCatalog;

function load(locale: 'es' | 'en'): Catalog {
  return JSON.parse(
    readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8'),
  ) as Catalog;
}

/** The UI copy the screens must show, read from the same catalogs the app uses. */
export const catalogs = { es: load('es'), en: load('en') };

interface NoticeEmail {
  subject: string;
}

interface EmailCatalog {
  two_factor_enabled: NoticeEmail;
  two_factor_disabled: NoticeEmail;
}

function loadEmails(locale: 'es' | 'en'): EmailCatalog {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../../api/src/identity/infrastructure/email/messages/${locale}.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  ) as EmailCatalog;
}

/** The API's email copy, so the e2e flows can recognise the notices it sends. */
export const emailCatalogs = { es: loadEmails('es'), en: loadEmails('en') };
