import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from '../src/app/manifest';

type Catalog = { [key: string]: string | Catalog };

const LOCALES = ['es', 'en'] as const;

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

function readString(catalog: Catalog, dottedKey: string): string | undefined {
  let current: string | Catalog | undefined = catalog;
  for (const part of dottedKey.split('.')) {
    if (current === undefined || typeof current === 'string') return undefined;
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

/** Dotted keys of every string that still names the old product (any case; "Argentina" is fine). */
function productNameLeaks(catalog: Catalog, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value !== 'string') return productNameLeaks(value, path);
    return /\bargent\b/i.test(value) ? [path] : [];
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

describe('product name in the web catalogs (FEAT-002)', () => {
  it.each(LOCALES)('titles the app "Pesly" in %s', (locale) => {
    const catalog = loadCatalog(locale);

    expect(readString(catalog, 'metadata.title')).toBe('Pesly');
    expect(readString(catalog, 'home.title')).toBe('Pesly');
  });

  it('installs the PWA as Pesly', () => {
    expect(manifest().name).toBe('Pesly');
    expect(manifest().short_name).toBe('Pesly');
  });

  it.each(LOCALES)('has no string naming Argent, in any case, in %s', (locale) => {
    expect(productNameLeaks(loadCatalog(locale))).toEqual([]);
  });

  it.each([
    ['es', 'pesly-codigos-de-recuperacion.txt'],
    ['en', 'pesly-recovery-codes.txt'],
  ])('names the recovery codes file and header after Pesly in %s', (locale, fileName) => {
    const catalog = loadCatalog(locale);

    expect(readString(catalog, 'security.recoveryCodes.fileName')).toBe(fileName);
    expect(readString(catalog, 'security.recoveryCodes.fileHeader')).toMatch(/\bPesly\b/);
  });

  it('product name error: reports every leak by its dotted key, in any case, and not "Argentina"', () => {
    const catalog: Catalog = {
      metadata: { title: 'Argent' },
      twoFactor: { recoveryCodes: { fileName: 'argent-recovery-codes.txt' } },
      home: { tagline: 'Your finances in Argentina' },
    };

    expect(productNameLeaks(catalog)).toEqual([
      'metadata.title',
      'twoFactor.recoveryCodes.fileName',
    ]);
  });
});
