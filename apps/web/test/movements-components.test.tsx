// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import { formatRate } from '../src/features/movements/format-rate';
import {
  movementFailureErrors,
  type MovementFormErrors,
} from '../src/features/movements/movement-form-errors';
import {
  MovementForm,
  type MovementFormProps,
  type MovementFormValues,
} from '../src/features/movements/components/movement-form';
import { RateField } from '../src/features/movements/components/rate-field';
import type { ApiFailure } from '../src/lib/api-client';

afterEach(cleanup);

const CATALOGS = { es, en } as const;

function renderIntl(ui: ReactElement, locale: 'es' | 'en' = 'es') {
  return render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={CATALOGS[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const ACCOUNTS = [
  { id: 'a1', name: 'Caja', currency: 'ARS' },
  { id: 'a2', name: 'Dolares', currency: 'USD' },
];
const CATEGORIES = [
  { id: 'c1', kind: 'expense' as const, label: 'Comida' },
  { id: 'c2', kind: 'income' as const, label: 'Sueldo' },
  { id: 'c3', kind: 'expense' as const, label: 'Transporte' },
];

function form(overrides: Partial<MovementFormProps> = {}) {
  const onSubmit = vi.fn<(values: MovementFormValues) => void>();
  const props: MovementFormProps = {
    accounts: ACCOUNTS,
    categories: CATEGORIES,
    defaultOccurredAt: '2026-10-02T12:30',
    defaultRate: '1250,5',
    rateType: 'blue',
    rateAgeHours: undefined,
    pending: false,
    errors: {},
    onSubmit,
    ...overrides,
  };
  return { onSubmit, ...renderIntl(<MovementForm {...props} />) };
}

const label = (text: string) => screen.getByLabelText<HTMLInputElement>(text);

describe('MovementForm', () => {
  it('renders every field with an associated label and the translated title', () => {
    form();

    expect(screen.getByRole('heading', { level: 1, name: es.movements.new.title })).toBeDefined();
    for (const name of [
      es.movements.fields.type,
      es.movements.fields.account,
      es.movements.fields.category,
      es.movements.fields.amount,
      es.movements.fields.occurredAt,
      es.movements.fields.rate,
      es.movements.fields.note,
    ]) {
      expect(screen.getByLabelText(name)).toBeDefined();
    }
  });

  it('shows the date and time in a datetime-local control with the given default, editable (AC-31)', async () => {
    form();
    const field = label(es.movements.fields.occurredAt);

    expect(field.type).toBe('datetime-local');
    expect(field.value).toBe('2026-10-02T12:30');
    await userEvent.setup().clear(field);
    expect(field.value).toBe('');
  });

  it('lists only the categories of the chosen type and switches with the type (AC-03)', async () => {
    form();
    const category = () => screen.getByLabelText(es.movements.fields.category);
    const names = () =>
      within(category())
        .getAllByRole('option')
        .map((option) => option.textContent);

    expect(names()).toEqual([es.movements.fields.categoryPlaceholder, 'Comida', 'Transporte']);
    await userEvent.setup().selectOptions(label(es.movements.fields.type), 'income');

    expect(names()).toEqual([es.movements.fields.categoryPlaceholder, 'Sueldo']);
  });

  it('submits what was typed, untouched, with the rate flagged as not edited', async () => {
    const { onSubmit } = form();
    const user = userEvent.setup();

    await user.selectOptions(label(es.movements.fields.account), 'a1');
    await user.selectOptions(label(es.movements.fields.category), 'c1');
    await user.type(label(es.movements.fields.amount), '1.500,50');
    await user.type(label(es.movements.fields.note), 'Almuerzo');
    await user.click(screen.getByRole('button', { name: es.movements.form.submit }));

    expect(onSubmit).toHaveBeenCalledWith({
      type: 'expense',
      accountId: 'a1',
      categoryId: 'c1',
      amount: '1.500,50',
      occurredAt: '2026-10-02T12:30',
      rate: '1250,5',
      rateEdited: false,
      note: 'Almuerzo',
    });
  });

  it('flags the rate as edited once the user types in it, even to the same value (AC-08)', async () => {
    const { onSubmit } = form();
    const user = userEvent.setup();
    const rate = label(es.movements.fields.rate);

    await user.type(rate, '0');
    await user.type(rate, '{Backspace}');
    await user.click(screen.getByRole('button', { name: es.movements.form.submit }));

    const [values] = onSubmit.mock.calls[0] ?? [];
    expect(values?.rate).toBe('1250,5');
    expect(values?.rateEdited).toBe(true);
  });

  it('ties each field error to its control and focuses the first invalid one (accessibility)', () => {
    const errors: MovementFormErrors = {
      fields: {
        account: 'movements.errors.accountRequired',
        amount: 'movements.errors.amountNotPositive',
      },
    };
    form({ errors });

    const account = label(es.movements.fields.account);
    const amount = label(es.movements.fields.amount);
    expect(account.getAttribute('aria-invalid')).toBe('true');
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(label(es.movements.fields.note).getAttribute('aria-invalid')).toBe('false');
    const message = document.getElementById(amount.getAttribute('aria-describedby') ?? '');
    expect(message?.textContent).toBe(es.movements.errors.amountNotPositive);
    expect(document.activeElement).toBe(account);
  });

  it('shows "Amount must be greater than 0" in English (AC-02)', () => {
    renderIntl(
      <MovementForm
        accounts={ACCOUNTS}
        categories={CATEGORIES}
        defaultOccurredAt="2026-10-02T12:30"
        defaultRate=""
        rateType={undefined}
        rateAgeHours={undefined}
        pending={false}
        errors={{ fields: { amount: 'movements.errors.amountNotPositive' } }}
        onSubmit={vi.fn()}
      />,
      'en',
    );

    expect(screen.getByText('Amount must be greater than 0')).toBeDefined();
  });

  it('shows the too-many-requests message with the seconds to wait, or without them', () => {
    const { unmount } = form({ errors: { rateLimit: { seconds: 42 } } });
    expect(screen.getByRole('alert').textContent).toContain('42');
    unmount();
    form({ errors: { rateLimit: {} } });
    expect(screen.getByRole('alert').textContent).toBe(es.movements.errors.rateLimitedGeneric);
  });

  it('disables the submit button while pending and shows the form-level error', () => {
    form({ pending: true, errors: { form: 'unexpected' } });

    expect(
      screen.getByRole('button', { name: es.movements.form.pending }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe(es.errors.unexpected);
  });
});

describe('RateField', () => {
  function rateField(props: Partial<Parameters<typeof RateField>[0]> = {}) {
    return renderIntl(
      <RateField
        defaultValue="1250,5"
        rateType="blue"
        ageHours={undefined}
        error={undefined}
        onEdited={vi.fn()}
        {...props}
      />,
    );
  }

  it('prefills the stored rate and says it is automatic', () => {
    rateField();

    expect(label(es.movements.fields.rate).value).toBe('1250,5');
    expect(
      screen.getByText(
        es.movements.rate.automatic.replace('{rateType}', es.profile.rateTypes.blue),
      ),
    ).toBeDefined();
    expect(label(es.movements.fields.rate).required).toBe(false);
  });

  it('is empty and required when no rate is stored (AC-20)', () => {
    rateField({ defaultValue: '', rateType: undefined });

    const field = label(es.movements.fields.rate);
    expect(field.value).toBe('');
    expect(field.required).toBe(true);
    expect(screen.getByText(es.movements.rate.missing)).toBeDefined();
  });

  it('shows "rate from 3 h ago" only when an age is given (AC-11)', () => {
    const { unmount } = rateField({ ageHours: 3 });
    expect(screen.getByRole('status').textContent).toBe(
      es.movements.rate.age.replace('{hours}', '3'),
    );
    unmount();
    rateField();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('reports the first edit', async () => {
    const onEdited = vi.fn();
    rateField({ onEdited });

    await userEvent.setup().type(label(es.movements.fields.rate), '1');

    expect(onEdited).toHaveBeenCalled();
  });
});

describe('formatRate', () => {
  it.each([
    [12505000n, 'en', '1,250.50'],
    [12505000n, 'es', '1250,50'],
    [12505001n, 'en', '1,250.5001'],
    [10000n, 'en', '1.00'],
  ] as const)('formats %s in %s as %s without a float', (value, locale, expected) => {
    expect(formatRate(value, locale)).toBe(expected);
  });
});

describe('movementFailureErrors', () => {
  function failure(code: ApiFailure['code'], extra: Partial<ApiFailure> = {}): ApiFailure {
    return { ok: false, code, messageKey: 'unexpected', ...extra };
  }

  it.each([
    ['RATE_REQUIRED', 'rate', 'errors.rateRequired'],
    ['MOVEMENT_DATE_IN_FUTURE', 'occurredAt', 'errors.movementDateInFuture'],
    ['MOVEMENT_CATEGORY_KIND_MISMATCH', 'category', 'errors.movementCategoryKindMismatch'],
    ['CATEGORY_ARCHIVED', 'category', 'errors.categoryArchived'],
    ['ACCOUNT_ARCHIVED', 'account', 'movements.errors.accountArchived'],
  ] as const)('puts %s on the %s field', (code, field, message) => {
    expect(movementFailureErrors(failure(code))).toEqual({ fields: { [field]: message } });
  });

  it('keeps the movement wording apart from the account-archived wording of the global mapping', () => {
    const errors = movementFailureErrors(failure('ACCOUNT_ARCHIVED'));

    expect(errors.fields?.account).not.toBe('errors.accountArchived');
  });

  it('carries the seconds of a rate limit, or none when the header was missing', () => {
    expect(movementFailureErrors(failure('RATE_LIMITED', { retryAfterSeconds: 30 }))).toEqual({
      rateLimit: { seconds: 30 },
    });
    expect(movementFailureErrors(failure('RATE_LIMITED'))).toEqual({ rateLimit: {} });
  });

  it('shows any other failure as the generic form message', () => {
    expect(movementFailureErrors(failure('INTERNAL', { messageKey: 'unexpected' }))).toEqual({
      form: 'unexpected',
    });
    expect(movementFailureErrors(failure('NETWORK', { messageKey: 'network' }))).toEqual({
      form: 'network',
    });
  });
});
