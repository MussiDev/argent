import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderEmail } from '../../src/identity/infrastructure/email/render-email';

type Catalog = { [key: string]: string | Catalog };

function loadCatalog(locale: string): Catalog {
  const path = fileURLToPath(
    new URL(`../../src/identity/infrastructure/email/messages/${locale}.json`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, 'utf8')) as Catalog;
}

function flattenKeys(catalog: Catalog, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [path] : flattenKeys(value, path);
  });
}

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO-_';

describe('email catalogs (NFR-10)', () => {
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

describe('renderEmail', () => {
  it('renders the verification email in each language with a link built from WEB_BASE_URL', () => {
    const es = renderEmail({
      kind: 'verification',
      language: 'es',
      token: TOKEN,
      webBaseUrl: 'https://app.argent.test',
    });
    const en = renderEmail({
      kind: 'verification',
      language: 'en',
      token: TOKEN,
      webBaseUrl: 'https://app.argent.test',
    });

    const esLink = `https://app.argent.test/es/verify-email?token=${TOKEN}`;
    const enLink = `https://app.argent.test/en/verify-email?token=${TOKEN}`;
    expect(es.text).toContain(esLink);
    expect(es.html).toContain(`href="${esLink}"`);
    expect(en.text).toContain(enLink);
    expect(es.subject).not.toBe(en.subject);
    expect(es.subject.length).toBeGreaterThan(0);
  });

  it('renders the password reset email with the reset link', () => {
    const email = renderEmail({
      kind: 'password_reset',
      language: 'en',
      token: TOKEN,
      webBaseUrl: 'https://app.argent.test',
    });

    expect(email.text).toContain(`https://app.argent.test/en/reset-password?token=${TOKEN}`);
  });

  it('keeps a path prefix of WEB_BASE_URL, with or without a trailing slash', () => {
    for (const webBaseUrl of ['https://argent.test/app', 'https://argent.test/app/']) {
      const email = renderEmail({ kind: 'verification', language: 'es', token: TOKEN, webBaseUrl });
      expect(email.text).toContain(`https://argent.test/app/es/verify-email?token=${TOKEN}`);
    }
  });
});
