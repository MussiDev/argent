import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATEGORY_COLORS, CATEGORY_ICONS, DEFAULT_CATEGORIES } from '@pesly/shared';
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

/** Every string of a catalog branch, with its dotted key. */
function stringsOf(catalog: Catalog, prefix = ''): [string, string][] {
  return Object.entries(catalog).flatMap(([key, value]): [string, string][] => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [[path, value]] : stringsOf(value, path);
  });
}

describe('categories catalog (DISC-001-02b)', () => {
  it.each(LOCALES)('has a categories namespace and a nav label in %s', (locale) => {
    const catalog = loadCatalog(locale);

    expect(readString(catalog, 'categories.title')).toBeTruthy();
    expect(readString(catalog, 'app.nav.categories')).toBeTruthy();
  });

  it.each(LOCALES)(
    'does not duplicate any default category name in the %s namespace (shared catalog is the source)',
    (locale) => {
      const namespace = loadCatalog(locale)['categories'];
      expect(typeof namespace).toBe('object');
      const defaultNames = new Set(
        DEFAULT_CATEGORIES.flatMap((entry) => [entry.names.es, entry.names.en]),
      );
      const leaks = stringsOf(namespace as Catalog, 'categories')
        .filter(([, value]) => defaultNames.has(value))
        .map(([key]) => key);

      expect(leaks).toEqual([]);
    },
  );

  it.each(LOCALES)('labels every category icon and color in %s', (locale) => {
    const catalog = loadCatalog(locale);

    for (const icon of CATEGORY_ICONS) {
      expect(readString(catalog, `categories.icons.${icon}`)).toBeTruthy();
    }
    for (const color of CATEGORY_COLORS) {
      expect(readString(catalog, `categories.colors.${color}`)).toBeTruthy();
    }
  });

  it('default-name error: reports a namespace string equal to a default name', () => {
    const namespace: Catalog = { sections: { expense: 'Comida' }, title: 'Categories' };
    const defaultNames = new Set(['Comida']);

    expect(
      stringsOf(namespace, 'categories')
        .filter(([, value]) => defaultNames.has(value))
        .map(([key]) => key),
    ).toEqual(['categories.sections.expense']);
  });
});

describe('available balance labels (FEAT-003 AC-23, NFR-05)', () => {
  it.each([
    ['es', 'accounts.headline.available', 'Disponible'],
    ['es', 'accounts.headline.netWorth', 'Patrimonio neto'],
    ['es', 'accounts.debt.title', 'Deudas'],
    ['es', 'accounts.fields.includeInAvailable', 'Incluir en disponible'],
    ['en', 'accounts.headline.available', 'Available'],
    ['en', 'accounts.headline.netWorth', 'Net worth'],
    ['en', 'accounts.debt.title', 'Debt'],
    ['en', 'accounts.fields.includeInAvailable', 'Include in available'],
  ])('holds the exact wording in %s for %s', (locale, key, wording) => {
    expect(readString(loadCatalog(locale), key)).toBe(wording);
  });

  it.each(LOCALES)('has a non-empty accountArchived error in %s', (locale) => {
    expect(readString(loadCatalog(locale), 'errors.accountArchived')?.length).toBeGreaterThan(0);
  });
});

describe('investments catalog (DISC-001-07a)', () => {
  it.each(LOCALES)('has the investments namespace and the navigation label in %s', (locale) => {
    const catalog = loadCatalog(locale);

    expect(typeof catalog.investments).toBe('object');
    expect(readString(catalog, 'investments.title')).toBeTruthy();
    expect(readString(catalog, 'app.nav.investments')).toBeTruthy();
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

describe('movements catalog (DISC-001-03b)', () => {
  it.each(LOCALES)('has a message for each of the four new error codes in %s', (locale) => {
    const catalog = loadCatalog(locale);

    for (const key of [
      'movementDateInFuture',
      'rateRequired',
      'movementCategoryKindMismatch',
      'categoryArchived',
    ]) {
      expect(readString(catalog, `errors.${key}`)?.length).toBeGreaterThan(0);
    }
  });

  it.each(LOCALES)(
    'has a movement-specific archived-account message that does not reuse the account one in %s',
    (locale) => {
      const catalog = loadCatalog(locale);
      const own = readString(catalog, 'movements.errors.accountArchived');

      expect(own?.length).toBeGreaterThan(0);
      expect(own).not.toBe(readString(catalog, 'errors.accountArchived'));
    },
  );

  it.each(LOCALES)('has the entry screen strings in %s', (locale) => {
    const catalog = loadCatalog(locale);

    for (const key of [
      'movements.new.title',
      'movements.fields.amount',
      'movements.fields.occurredAt',
      'movements.fields.rate',
      'movements.rate.age',
      'movements.errors.amountNotPositive',
      'movements.errors.rateLimited',
      'movements.saved.rate',
    ]) {
      expect(readString(catalog, key)?.length).toBeGreaterThan(0);
    }
  });

  it('maps every error code the API sends to a message that exists in both catalogs', async () => {
    const { ERROR_CODES } = await import('@pesly/shared');
    const { createApiClient } = await import('../src/lib/api-client');
    const keys = new Set<string>();
    for (const code of ERROR_CODES) {
      const client = createApiClient({
        baseUrl: 'http://api.argent.test',
        fetch: () => Promise.resolve(new Response(JSON.stringify({ code }), { status: 400 })),
      });
      const result = await client.listMovements({});
      if (!result.ok) keys.add(result.messageKey);
    }

    for (const locale of LOCALES) {
      const catalog = loadCatalog(locale);
      expect([...keys].filter((key) => readString(catalog, `errors.${key}`) === undefined)).toEqual(
        [],
      );
    }
  });
});
