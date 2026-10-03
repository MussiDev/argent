// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import { ThemeProvider } from '../src/components/theme-provider';
import { ThemeToggle } from '../src/components/theme-toggle';
import { THEME_STORAGE_KEY } from '../src/lib/theme';

type Listener = (event: { matches: boolean }) => void;

/** A controllable `prefers-color-scheme` that notifies listeners when the "system" changes. */
function stubSystemPreference(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<Listener>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return dark;
    },
    media: query,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  }));
  return {
    set(next: boolean) {
      dark = next;
      for (const listener of listeners) listener({ matches: next });
    },
  };
}

function renderToggle(locale: 'en' | 'es' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : es}>
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

const isDark = () => document.documentElement.classList.contains('dark');

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ThemeProvider and ThemeToggle', () => {
  it('applies the chosen theme immediately and persists it after remount (AC-06)', async () => {
    stubSystemPreference(false);
    const user = userEvent.setup();
    const first = renderToggle();

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(isDark()).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    first.unmount();
    document.documentElement.classList.remove('dark');
    renderToggle();

    expect(isDark()).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Dark' }).checked).toBe(true);

    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(isDark()).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('follows the operating system with no stored theme and while system is chosen (AC-08)', () => {
    const system = stubSystemPreference(true);
    renderToggle();

    expect(isDark()).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'System' }).checked).toBe(true);

    act(() => {
      system.set(false);
    });
    expect(isDark()).toBe(false);
  });

  it('ignores the operating system once light or dark is chosen', async () => {
    const system = stubSystemPreference(false);
    const user = userEvent.setup();
    renderToggle();

    await user.click(screen.getByRole('radio', { name: 'Light' }));
    act(() => {
      system.set(true);
    });

    expect(isDark()).toBe(false);
  });

  it('treats a tampered stored value as system', () => {
    stubSystemPreference(false);
    localStorage.setItem(THEME_STORAGE_KEY, '<img src=x>');

    renderToggle();

    expect(isDark()).toBe(false);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'System' }).checked).toBe(true);
  });

  it('keeps the theme in memory when localStorage throws', async () => {
    stubSystemPreference(false);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    const user = userEvent.setup();

    renderToggle();
    await user.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(isDark()).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Dark' }).checked).toBe(true);
  });

  it('labels the three options in the active language', () => {
    stubSystemPreference(false);
    renderToggle('es');

    expect(screen.getByRole('radio', { name: 'Claro' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Oscuro' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Sistema' })).toBeTruthy();
  });

  it('keeps every option at least 44px tall (class contract)', () => {
    stubSystemPreference(false);
    renderToggle();

    const option = screen.getByRole('radio', { name: 'Dark' }).closest('label');
    expect(option?.className).toMatch(/min-h-11/);
  });
});
