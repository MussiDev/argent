// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PreferencesForm } from '../src/features/profile/components/preferences-form';
import { ProfileForm } from '../src/features/profile/components/profile-form';
import { CATALOGS, renderApp } from './support/render-app';

const { es, en } = CATALOGS;

const PREFERENCES = {
  defaultRateType: 'blue',
  displayCurrency: 'ARS',
  timeZone: 'America/Argentina/Buenos_Aires',
  language: 'es',
} as const;
const TIME_ZONES = ['America/Argentina/Buenos_Aires', 'Europe/Madrid'];

function renderProfileForm(props: Partial<Parameters<typeof ProfileForm>[0]> = {}) {
  const onSubmit = vi.fn();
  renderApp(
    <ProfileForm
      displayName="Ana"
      email="ana@example.com"
      twoFactorEnabled={false}
      pending={false}
      saved={false}
      errors={{}}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit };
}

function renderPreferencesForm(props: Partial<Parameters<typeof PreferencesForm>[0]> = {}) {
  const onSubmit = vi.fn();
  renderApp(
    <PreferencesForm
      preferences={PREFERENCES}
      timeZones={TIME_ZONES}
      pending={false}
      saved={false}
      errors={{}}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit };
}

describe('ProfileForm', () => {
  it('shows the name in a field, the email as text and the 2FA status (AC-01, FR-03)', () => {
    renderProfileForm({ twoFactorEnabled: true });

    expect(screen.getByLabelText<HTMLInputElement>(es.profile.account.displayName).value).toBe(
      'Ana',
    );
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByText('ana@example.com').tagName).not.toBe('INPUT');
    expect(screen.getByText(es.profile.account.twoFactorOn)).toBeDefined();
  });

  it('shows 2FA as not enabled and an empty field for a null name (AC-01)', () => {
    renderProfileForm({ displayName: null });

    expect(screen.getByLabelText<HTMLInputElement>(es.profile.account.displayName).value).toBe('');
    expect(screen.getByText(es.profile.account.twoFactorOff)).toBeDefined();
  });

  it('submits the typed name as it is, leaving validation to the container', async () => {
    const { onSubmit } = renderProfileForm();
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText(es.profile.account.displayName));
    await user.type(screen.getByLabelText(es.profile.account.displayName), ' Bea ');
    await user.click(screen.getByRole('button', { name: es.profile.account.submit }));

    expect(onSubmit).toHaveBeenCalledWith({ displayName: ' Bea ' });
  });

  it('shows a field error on the name, marks it invalid and moves focus to it (AC-03)', () => {
    renderProfileForm({ errors: { fields: { displayName: 'displayNameTooLong' } } });

    const field = screen.getByLabelText(es.profile.account.displayName);
    expect(screen.getByText(es.profile.errors.displayNameTooLong)).toBeDefined();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field);
  });

  it('shows a form error above the fields and disables the button while pending', () => {
    renderProfileForm({ errors: { form: 'validationFailed' }, pending: true });

    expect(screen.getByText(es.errors.validationFailed)).toBeDefined();
    const button = screen.getByRole<HTMLButtonElement>('button', {
      name: es.profile.account.pending,
    });
    expect(button.disabled).toBe(true);
  });

  it('confirms a save with a status message', () => {
    renderProfileForm({ saved: true });

    expect(screen.getByRole('status').textContent).toBe(es.profile.saved);
  });
});

describe('PreferencesForm', () => {
  it('shows the saved preferences as the selected options (AC-05, AC-06, AC-07)', () => {
    renderPreferencesForm();

    const value = (label: string) => screen.getByLabelText<HTMLSelectElement>(label).value;
    expect(value(es.profile.preferences.defaultRateType)).toBe('blue');
    expect(value(es.profile.preferences.displayCurrency)).toBe('ARS');
    expect(value(es.profile.preferences.timeZone)).toBe('America/Argentina/Buenos_Aires');
    expect(value(es.profile.preferences.language)).toBe('es');
    expect(
      within(screen.getByLabelText(es.profile.preferences.timeZone))
        .getAllByRole('option')
        .map((option) => option.getAttribute('value')),
    ).toEqual(TIME_ZONES);
  });

  it('submits every select value, labelled from the catalog', async () => {
    const { onSubmit } = renderPreferencesForm();
    const user = userEvent.setup();

    await user.selectOptions(
      screen.getByLabelText(es.profile.preferences.defaultRateType),
      es.profile.rateTypes.ccl,
    );
    await user.selectOptions(
      screen.getByLabelText(es.profile.preferences.timeZone),
      'Europe/Madrid',
    );
    await user.selectOptions(screen.getByLabelText(es.profile.preferences.language), 'en');
    await user.click(screen.getByRole('button', { name: es.profile.preferences.submit }));

    expect(onSubmit).toHaveBeenCalledWith({
      defaultRateType: 'ccl',
      displayCurrency: 'ARS',
      timeZone: 'Europe/Madrid',
      language: 'en',
    });
  });

  it('shows the time zone field error and form error, and disables the button while pending', () => {
    renderPreferencesForm({
      errors: { form: 'network', fields: { timeZone: 'timeZoneInvalid' } },
      pending: true,
    });

    expect(screen.getByText(es.profile.errors.timeZoneInvalid)).toBeDefined();
    expect(screen.getByText(es.errors.network)).toBeDefined();
    expect(
      screen.getByLabelText(es.profile.preferences.timeZone).getAttribute('aria-invalid'),
    ).toBe('true');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: es.profile.preferences.pending })
        .disabled,
    ).toBe(true);
  });

  it('confirms a save with a status message in the current language', () => {
    renderApp(
      <PreferencesForm
        preferences={PREFERENCES}
        timeZones={TIME_ZONES}
        pending={false}
        saved
        errors={{}}
        onSubmit={vi.fn()}
      />,
      { locale: 'en' },
    );

    expect(screen.getByRole('status').textContent).toBe(en.profile.saved);
  });
});
