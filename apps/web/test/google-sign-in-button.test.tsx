// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GoogleSignInButton } from '../src/features/auth/components/google-sign-in-button';
import { CATALOGS, renderApp, type TestLocale } from './support/render-app';

const START_URL = 'http://api.argent.test/auth/google/start?timeZone=UTC&language=es';

describe('GoogleSignInButton', () => {
  it.each(['es', 'en'] as TestLocale[])(
    'renders the %s label and links to the start URL (FR-01)',
    (locale) => {
      renderApp(<GoogleSignInButton href={START_URL} />, { locale });

      const link = screen.getByRole('link', { name: CATALOGS[locale].auth.google.continue });
      expect(link.getAttribute('href')).toBe(START_URL);
    },
  );

  it('hides the Google mark from assistive technology', () => {
    renderApp(<GoogleSignInButton href={START_URL} />);

    const link = screen.getByRole('link', { name: CATALOGS.es.auth.google.continue });
    const mark = link.querySelector('svg');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(link.textContent).toBe(CATALOGS.es.auth.google.continue);
  });
});
