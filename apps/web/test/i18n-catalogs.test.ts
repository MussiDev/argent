import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Catalog = { [key: string]: string | Catalog };

function loadCatalog(locale: string): Catalog {
  const path = fileURLToPath(new URL(`../messages/${locale}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Catalog;
}

function flattenKeys(catalog: Catalog, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [path] : flattenKeys(value, path);
  });
}

describe('i18n catalogs (NFR-10)', () => {
  const esKeys = flattenKeys(loadCatalog('es'));
  const enKeys = flattenKeys(loadCatalog('en'));

  it('is not empty', () => {
    expect(esKeys.length).toBeGreaterThan(0);
  });

  it('has every es key in en', () => {
    expect(esKeys.filter((key) => !enKeys.includes(key))).toEqual([]);
  });

  it('has every en key in es', () => {
    expect(enKeys.filter((key) => !esKeys.includes(key))).toEqual([]);
  });
});
