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
