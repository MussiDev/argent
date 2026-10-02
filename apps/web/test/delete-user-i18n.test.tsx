import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NextIntlClientProvider, type IntlError } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import { DeleteUserForm } from '../src/features/profile/components/delete-user-form';
import { DeleteUserGoogle } from '../src/features/profile/components/delete-user-google';

const CATALOGS = { es, en } as const;
const noop = () => undefined;

const SCREENS: [string, ReactElement][] = [
  [
    'delete form (password and code, with errors)',
    <DeleteUserForm
      key="form"
      requirePassword
      requireCode
      pending={false}
      errors={{
        form: 'invalidCredentials',
        fields: { password: 'passwordRequired', code: 'secondFactorCodeFormat' },
      }}
      onSubmit={noop}
    />,
  ],
  [
    'delete form (Google confirmed, pending)',
    <DeleteUserForm
      key="form-google"
      requirePassword={false}
      requireCode={false}
      pending
      errors={{}}
      onSubmit={noop}
    />,
  ],
  [
    'Google step (failed)',
    <DeleteUserGoogle
      key="google"
      pending={false}
      failed
      error="reauthenticationRequired"
      onStart={noop}
    />,
  ],
  [
    'Google step (reauthentication required, prominent hint)',
    <DeleteUserGoogle
      key="google-required"
      pending={false}
      failed={false}
      error="reauthenticationRequired"
      onStart={noop}
    />,
  ],
  [
    'Google step (pending)',
    <DeleteUserGoogle key="google-pending" pending failed={false} onStart={noop} />,
  ],
];

describe('delete-account screens in every language (FR-01)', () => {
  describe.each(['es', 'en'] as const)('/%s', (locale) => {
    it.each(SCREENS)('%s renders with no missing keys', (_name, element) => {
      const errors: IntlError[] = [];
      const html = renderToStaticMarkup(
        <NextIntlClientProvider
          locale={locale}
          timeZone="UTC"
          messages={CATALOGS[locale]}
          onError={(error) => errors.push(error)}
        >
          {element}
        </NextIntlClientProvider>,
      );

      expect(errors.map((error) => error.message)).toEqual([]);
      expect(html.length).toBeGreaterThan(0);
    });
  });
});

describe('delete-account catalogs (FR-01)', () => {
  function keys(value: object, prefix = ''): string[] {
    return Object.entries(value).flatMap(([key, child]) =>
      typeof child === 'string' ? [`${prefix}${key}`] : keys(child as object, `${prefix}${key}.`),
    );
  }

  it('have the same keys in the deleteUser namespace and the profile link', () => {
    expect(keys(en.deleteUser).length).toBeGreaterThan(8);
    expect(keys(en.deleteUser).sort()).toEqual(keys(es.deleteUser).sort());
    expect(keys(en.profile.deleteAccount).sort()).toEqual(keys(es.profile.deleteAccount).sort());
  });

  it('have no empty string and a different text per language', () => {
    for (const key of keys(en.deleteUser)) {
      const read = (catalog: object) =>
        key
          .split('.')
          .reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], catalog);
      expect(read(en.deleteUser)).toBeTruthy();
      expect(read(es.deleteUser)).toBeTruthy();
    }
    expect(en.deleteUser.submit).not.toBe(es.deleteUser.submit);
    for (const key of ['title', 'body', 'note', 'link'] as const) {
      expect(en.deleteUser.setPassword[key]).not.toBe(es.deleteUser.setPassword[key]);
    }
  });
});

describe('no string is hard-coded in the delete-account components (FR-01)', () => {
  const SRC = fileURLToPath(new URL('../src/', import.meta.url));
  const FILES = [
    ...collect(`${SRC}features/profile`).filter((file) => /delete-user/.test(file)),
    `${SRC}features/profile/containers/profile-container.tsx`,
    `${SRC}app/[locale]/(app)/settings/delete-account/page.tsx`,
  ];

  function collect(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
      const path = `${directory}/${name}`;
      return statSync(path).isDirectory() ? collect(path) : [path];
    });
  }

  it('finds the new files', () => {
    expect(FILES.filter((file) => file.endsWith('.tsx')).length).toBeGreaterThanOrEqual(5);
  });

  it.each(FILES.filter((file) => file.endsWith('.tsx')))(
    '%s has no JSX text and no literal text attribute',
    (file) => {
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const jsxText = [...source.matchAll(/>\s*([^<>{}\n]*[A-Za-z]{2,}[^<>{}\n]*)\s*</g)].map(
        (match) => match[1],
      );
      const textAttributes = [
        ...source.matchAll(
          /\b(?:aria-label|title|placeholder|alt|label)="[^"]*[A-Za-z]{2,}[^"]*"/g,
        ),
      ].map((match) => match[0]);

      expect([...jsxText, ...textAttributes]).toEqual([]);
    },
  );
});
