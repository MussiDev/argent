// @vitest-environment happy-dom
import {
  ACCOUNT_CURRENCIES,
  ACCOUNT_NAME_MAX_LENGTH,
  ACCOUNT_TYPES,
  formatMoney,
  type AccountResponse,
} from '@pesly/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import { AccountForm } from '../src/features/accounts/components/account-form';
import {
  AccountList,
  type AccountListProps,
} from '../src/features/accounts/components/account-list';
import {
  nameErrorMessage,
  type AccountFormErrors,
} from '../src/features/accounts/account-form-errors';

afterEach(cleanup);

const CATALOGS = { es, en } as const;

function renderIntl(ui: ReactElement, locale: 'es' | 'en' = 'es') {
  return render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={CATALOGS[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function markup(element: ReactElement): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="es" timeZone="UTC" messages={es}>
      {element}
    </NextIntlClientProvider>,
  );
}

/** Intl uses no-break spaces; Testing Library collapses them, so expectations do too. */
function money(value: bigint, currency: 'ARS' | 'USD', locale: 'es' | 'en'): string {
  return formatMoney(value, currency, locale).replace(/\s+/g, ' ');
}

function account(overrides: Partial<AccountResponse> = {}): AccountResponse {
  return {
    id: 'a1',
    name: 'Caja',
    type: 'cash',
    currency: 'ARS',
    openingBalance: '0',
    balance: '150000',
    archived: false,
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

const noop = () => undefined;

function listProps(overrides: Partial<AccountListProps> = {}): AccountListProps {
  return {
    accounts: [account()],
    totals: { ARS: '150000', USD: '0' },
    showArchived: false,
    pending: false,
    editingId: undefined,
    confirmingDeleteId: undefined,
    blockedDeleteId: undefined,
    renameError: undefined,
    actionError: undefined,
    onToggleArchived: noop,
    onStartRename: noop,
    onCancelRename: noop,
    onRename: noop,
    onArchive: noop,
    onUnarchive: noop,
    onAskDelete: noop,
    onCancelDelete: noop,
    onConfirmDelete: noop,
    ...overrides,
  };
}

describe('AccountForm', () => {
  it('offers exactly the five account types and the two currencies (AC-03)', () => {
    renderIntl(<AccountForm pending={false} errors={{}} onSubmit={noop} />);

    const type = screen.getByLabelText(es.accounts.fields.type);
    const typeOptions = within(type).getAllByRole<HTMLOptionElement>('option');
    expect(typeOptions.filter((option) => option.value !== '').map((o) => o.value)).toEqual([
      ...ACCOUNT_TYPES,
    ]);
    expect(typeOptions.filter((o) => o.value !== '').map((o) => o.textContent)).toEqual([
      es.accounts.types.cash,
      es.accounts.types.bank_account,
      es.accounts.types.digital_wallet,
      es.accounts.types.credit_card,
      es.accounts.types.savings,
    ]);

    const currency = screen.getByLabelText(es.accounts.fields.currency);
    const currencyOptions = within(currency).getAllByRole<HTMLOptionElement>('option');
    expect(currencyOptions.filter((o) => o.value !== '').map((o) => o.value)).toEqual([
      ...ACCOUNT_CURRENCIES,
    ]);
  });

  it('starts with no type or currency chosen and the opening balance pre-filled with 0 (AC-16)', () => {
    renderIntl(<AccountForm pending={false} errors={{}} onSubmit={noop} />);

    expect(screen.getByLabelText<HTMLSelectElement>(es.accounts.fields.type).value).toBe('');
    expect(screen.getByLabelText<HTMLSelectElement>(es.accounts.fields.currency).value).toBe('');
    expect(screen.getByLabelText<HTMLInputElement>(es.accounts.fields.openingBalance).value).toBe(
      '0',
    );
  });

  it('hands the raw field values to onSubmit', async () => {
    const onSubmit = vi.fn();
    renderIntl(<AccountForm pending={false} errors={{}} onSubmit={onSubmit} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(es.accounts.fields.name), 'Caja chica');
    await user.selectOptions(screen.getByLabelText(es.accounts.fields.type), 'savings');
    await user.selectOptions(screen.getByLabelText(es.accounts.fields.currency), 'USD');
    await user.clear(screen.getByLabelText(es.accounts.fields.openingBalance));
    await user.type(screen.getByLabelText(es.accounts.fields.openingBalance), '-1.500,00');
    await user.click(screen.getByRole('button', { name: es.accounts.form.submit }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      name: 'Caja chica',
      type: 'savings',
      currency: 'USD',
      openingBalance: '-1.500,00',
    });
  });

  it('disables the submit button while pending', () => {
    renderIntl(<AccountForm pending errors={{}} onSubmit={noop} />);

    expect(
      screen.getByRole('button', { name: es.accounts.form.pending }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('shows the form-level error in an alert', () => {
    renderIntl(<AccountForm pending={false} errors={{ form: 'network' }} onSubmit={noop} />);

    expect(screen.getByRole('alert').textContent).toContain(es.errors.network);
  });
});

const INVALID: AccountFormErrors = {
  fields: {
    name: 'accounts.errors.nameRequired',
    type: 'accounts.errors.typeRequired',
    currency: 'accounts.errors.currencyRequired',
    openingBalance: 'accounts.errors.amountInvalid',
  },
};

function describedByIds(html: string): string[] {
  return [...html.matchAll(/aria-describedby="([^"]*)"/g)].flatMap(([, ids = '']) =>
    ids.split(' ').filter(Boolean),
  );
}

describe('AccountForm accessibility', () => {
  it('leaves validation messages to the catalogs', () => {
    expect(markup(<AccountForm pending={false} errors={{}} onSubmit={noop} />)).toMatch(
      /<form[^>]* novalidate=""/i,
    );
  });

  it('only points aria-describedby at ids that exist', () => {
    for (const errors of [{}, INVALID]) {
      const html = markup(<AccountForm pending={false} errors={errors} onSubmit={noop} />);

      for (const id of describedByIds(html)) {
        expect(html, `aria-describedby points at missing #${id}`).toContain(`id="${id}"`);
      }
    }
  });

  it('marks each invalid field and describes it with its message', () => {
    renderIntl(<AccountForm pending={false} errors={INVALID} onSubmit={noop} />);

    const expected: [string, string][] = [
      [es.accounts.fields.name, es.accounts.errors.nameRequired],
      [es.accounts.fields.type, es.accounts.errors.typeRequired],
      [es.accounts.fields.currency, es.accounts.errors.currencyRequired],
      [es.accounts.fields.openingBalance, es.accounts.errors.amountInvalid],
    ];
    for (const [label, message] of expected) {
      const control = screen.getByLabelText(label);
      expect(control.getAttribute('aria-invalid')).toBe('true');
      const ids = (control.getAttribute('aria-describedby') ?? '').split(' ');
      const texts = ids.map((id) => document.getElementById(id)?.textContent);
      expect(texts).toContain(message);
    }
  });

  it('moves focus to the first invalid field', () => {
    renderIntl(<AccountForm pending={false} errors={INVALID} onSubmit={noop} />);

    expect(document.activeElement).toBe(screen.getByLabelText(es.accounts.fields.name));
  });

  it('shows the duplicate-name message from the errors catalog on the name field', () => {
    renderIntl(
      <AccountForm
        pending={false}
        errors={{ fields: { name: 'errors.accountNameTaken' } }}
        onSubmit={noop}
      />,
    );

    const name = screen.getByLabelText(es.accounts.fields.name);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(es.errors.accountNameTaken)).toBeDefined();
  });
});

describe('nameErrorMessage', () => {
  const ZWSP = '\u200B';
  const RLO = '\u202E';

  it('answers invalid characters for visible text next to a control or format character (AC-20)', () => {
    expect(nameErrorMessage(`Caja${ZWSP}${RLO}`)).toBe('accounts.errors.nameInvalidCharacters');
    expect(nameErrorMessage(`Ca${ZWSP}ja`)).toBe('accounts.errors.nameInvalidCharacters');
    expect(nameErrorMessage('Caja\u0000')).toBe('accounts.errors.nameInvalidCharacters');
    expect(nameErrorMessage('Caja\u00AD')).toBe('accounts.errors.nameInvalidCharacters');
  });

  it('answers invalid characters when trim would hide the control or format character', () => {
    expect(nameErrorMessage('\uFEFFCaja')).toBe('accounts.errors.nameInvalidCharacters');
    expect(nameErrorMessage('Caja\n')).toBe('accounts.errors.nameInvalidCharacters');
    expect(nameErrorMessage('\tCaja')).toBe('accounts.errors.nameInvalidCharacters');
  });

  it('answers required when nothing visible is left (AC-21)', () => {
    expect(nameErrorMessage(`${ZWSP}${ZWSP}`)).toBe('accounts.errors.nameRequired');
    expect(nameErrorMessage(`${RLO}\u200D\uFEFF`)).toBe('accounts.errors.nameRequired');
    expect(nameErrorMessage('   ')).toBe('accounts.errors.nameRequired');
    expect(nameErrorMessage('')).toBe('accounts.errors.nameRequired');
  });

  it('answers too long above 50 code points, counting an emoji once', () => {
    expect(nameErrorMessage('x'.repeat(51))).toBe('accounts.errors.nameTooLong');
    expect(nameErrorMessage('\u{1F4B0}'.repeat(51))).toBe('accounts.errors.nameTooLong');
  });
});

describe('AccountForm new messages', () => {
  it('shows the invalid-characters message on the name field', () => {
    renderIntl(
      <AccountForm
        pending={false}
        errors={{ fields: { name: 'accounts.errors.nameInvalidCharacters' } }}
        onSubmit={noop}
      />,
    );

    expect(screen.getByText(es.accounts.errors.nameInvalidCharacters)).toBeDefined();
    expect(screen.getByLabelText(es.accounts.fields.name).getAttribute('aria-invalid')).toBe(
      'true',
    );
  });

  it('interpolates the formatted limit into the out-of-range message', () => {
    const limit = money(10n ** 15n, 'ARS', 'es');
    renderIntl(
      <AccountForm
        pending={false}
        errors={{
          fields: { openingBalance: 'accounts.errors.amountOutOfRange' },
          openingBalanceLimit: limit,
        }}
        onSubmit={noop}
      />,
    );

    const control = screen.getByLabelText(es.accounts.fields.openingBalance);
    expect(control.getAttribute('aria-invalid')).toBe('true');
    const ids = (control.getAttribute('aria-describedby') ?? '').split(' ');
    const texts = ids.map((id) => document.getElementById(id)?.textContent.replace(/\s+/g, ' '));
    expect(texts).toContain(es.accounts.errors.amountOutOfRange.replace('{max}', limit));
  });
});

describe('accounts error copy', () => {
  it('has the two new messages in both languages, the amount one with the {max} slot', () => {
    for (const catalog of [es, en]) {
      expect(catalog.accounts.errors.nameInvalidCharacters.length).toBeGreaterThan(0);
      expect(catalog.accounts.errors.amountOutOfRange).toContain('{max}');
    }
    expect(es.accounts.errors.nameInvalidCharacters).not.toBe(
      en.accounts.errors.nameInvalidCharacters,
    );
  });
});

describe('AccountList', () => {
  it('shows each balance and both totals formatted for the active locale (AC-11, AC-12)', () => {
    const accounts = [
      account({ id: 'a1', name: 'Caja', currency: 'ARS', balance: '150000' }),
      account({ id: 'a2', name: 'Dolares', currency: 'USD', balance: '-2550' }),
    ];
    for (const locale of ['es', 'en'] as const) {
      renderIntl(
        <AccountList {...listProps({ accounts, totals: { ARS: '150000', USD: '-2550' } })} />,
        locale,
      );
      const catalog = CATALOGS[locale];

      const pesos = screen.getByRole('listitem', { name: 'Caja' });
      expect(within(pesos).getByText(money(150000n, 'ARS', locale))).toBeDefined();
      const dollars = screen.getByRole('listitem', { name: 'Dolares' });
      expect(within(dollars).getByText(money(-2550n, 'USD', locale))).toBeDefined();

      const totals = screen.getByRole('group', { name: catalog.accounts.list.totals });
      expect(within(totals).getByText(catalog.accounts.totals.ARS)).toBeDefined();
      expect(within(totals).getByText(money(150000n, 'ARS', locale))).toBeDefined();
      expect(within(totals).getByText(catalog.accounts.totals.USD)).toBeDefined();
      expect(within(totals).getByText(money(-2550n, 'USD', locale))).toBeDefined();
      cleanup();
    }
    expect(money(150000n, 'ARS', 'es')).not.toBe(money(150000n, 'ARS', 'en'));
  });

  it('formats balances and totals beyond int64 without throwing (AC-22, NFR-06)', () => {
    const accounts = [
      account({ id: 'a1', name: 'Caja', currency: 'ARS', balance: '9223372036854775808' }),
    ];
    for (const locale of ['es', 'en'] as const) {
      renderIntl(
        <AccountList
          {...listProps({ accounts, totals: { ARS: '9300000000000000000', USD: '0' } })}
        />,
        locale,
      );
      const catalog = CATALOGS[locale];
      const row = screen.getByRole('listitem', { name: 'Caja' });
      expect(within(row).getByText(money(9223372036854775808n, 'ARS', locale))).toBeDefined();
      const totals = screen.getByRole('group', { name: catalog.accounts.list.totals });
      expect(within(totals).getByText(money(9300000000000000000n, 'ARS', locale))).toBeDefined();
      cleanup();
    }
  });

  it('shows the type of each account through the catalog', () => {
    renderIntl(<AccountList {...listProps({ accounts: [account({ type: 'digital_wallet' })] })} />);

    expect(screen.getByText(es.accounts.types.digital_wallet)).toBeDefined();
  });

  it('shows the empty state and the link to create an account', () => {
    renderIntl(<AccountList {...listProps({ accounts: [] })} />);

    expect(screen.getByText(es.accounts.list.empty)).toBeDefined();
    const link = screen.getByRole('link', { name: es.accounts.list.newAccount });
    expect(link.getAttribute('href')).toBe('/es/accounts/new');
  });

  it('renders an account name containing markup as literal text (NFR-05)', () => {
    const name = '<img src=x onerror="alert(1)"><b>Caja</b>';
    const { container } = renderIntl(
      <AccountList {...listProps({ accounts: [account({ name })] })} />,
    );

    // The name is the row title and also the screen-reader suffix of each action.
    expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('reports each row action with the account id', async () => {
    const handlers = {
      onStartRename: vi.fn(),
      onArchive: vi.fn(),
      onAskDelete: vi.fn(),
    };
    renderIntl(<AccountList {...listProps(handlers)} />);
    const user = userEvent.setup();
    const row = screen.getByRole('listitem', { name: 'Caja' });

    await user.click(within(row).getByRole('button', { name: /^Renombrar/ }));
    await user.click(within(row).getByRole('button', { name: /^Archivar/ }));
    await user.click(within(row).getByRole('button', { name: /^Eliminar/ }));

    expect(handlers.onStartRename).toHaveBeenCalledExactlyOnceWith('a1');
    expect(handlers.onArchive).toHaveBeenCalledExactlyOnceWith('a1');
    expect(handlers.onAskDelete).toHaveBeenCalledExactlyOnceWith('a1');
  });

  it('offers unarchive instead of archive on the archived view, without totals', async () => {
    const onUnarchive = vi.fn();
    renderIntl(
      <AccountList
        {...listProps({
          showArchived: true,
          accounts: [account({ archived: true, archivedAt: '2026-10-02T00:00:00.000Z' })],
          onUnarchive,
        })}
      />,
    );
    const user = userEvent.setup();
    const row = screen.getByRole('listitem', { name: 'Caja' });

    expect(within(row).queryByRole('button', { name: /^Archivar/ })).toBeNull();
    await user.click(within(row).getByRole('button', { name: /^Desarchivar/ }));

    expect(onUnarchive).toHaveBeenCalledExactlyOnceWith('a1');
    expect(screen.queryByRole('group', { name: es.accounts.list.totals })).toBeNull();
  });

  it('toggles between the active and the archived accounts', async () => {
    const onToggleArchived = vi.fn();
    renderIntl(<AccountList {...listProps({ onToggleArchived })} />);

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: es.accounts.list.showArchived }));

    expect(onToggleArchived).toHaveBeenCalledOnce();
    cleanup();
    renderIntl(<AccountList {...listProps({ showArchived: true, accounts: [] })} />);
    expect(screen.getByRole('button', { name: es.accounts.list.showActive })).toBeDefined();
    expect(screen.getByText(es.accounts.list.emptyArchived)).toBeDefined();
  });

  it('renames inline: the field holds the current name and reports the new one', async () => {
    const onRename = vi.fn();
    const onCancelRename = vi.fn();
    renderIntl(<AccountList {...listProps({ editingId: 'a1', onRename, onCancelRename })} />);
    const user = userEvent.setup();

    const field = screen.getByLabelText(es.accounts.actions.renameField.replace('{name}', 'Caja'));
    expect((field as HTMLInputElement).value).toBe('Caja');
    await user.clear(field);
    await user.type(field, 'Billetera');
    await user.click(screen.getByRole('button', { name: es.accounts.actions.save }));
    await user.click(screen.getByRole('button', { name: es.accounts.actions.cancel }));

    expect(onRename).toHaveBeenCalledExactlyOnceWith('a1', 'Billetera');
    expect(onCancelRename).toHaveBeenCalledOnce();
  });

  it('shows the rename error on the field', () => {
    renderIntl(
      <AccountList {...listProps({ editingId: 'a1', renameError: 'errors.accountNameTaken' })} />,
    );

    const field = screen.getByLabelText(es.accounts.actions.renameField.replace('{name}', 'Caja'));
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(es.errors.accountNameTaken)).toBeDefined();
  });

  it('asks for confirmation before deleting', async () => {
    const onConfirmDelete = vi.fn();
    const onCancelDelete = vi.fn();
    renderIntl(
      <AccountList {...listProps({ confirmingDeleteId: 'a1', onConfirmDelete, onCancelDelete })} />,
    );
    const user = userEvent.setup();

    expect(
      screen.getByText(es.accounts.actions.confirmDelete.replace('{name}', 'Caja')),
    ).toBeDefined();
    await user.click(screen.getByRole('button', { name: es.accounts.actions.confirmDeleteYes }));
    await user.click(screen.getByRole('button', { name: es.accounts.actions.cancel }));

    expect(onConfirmDelete).toHaveBeenCalledExactlyOnceWith('a1');
    expect(onCancelDelete).toHaveBeenCalledOnce();
  });

  it('explains a blocked deletion and offers to archive instead (AC-10)', async () => {
    const onArchive = vi.fn();
    renderIntl(<AccountList {...listProps({ blockedDeleteId: 'a1', onArchive })} />);

    expect(screen.getByText(es.errors.accountHasMovements)).toBeDefined();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: es.accounts.actions.archiveInstead }));

    expect(onArchive).toHaveBeenCalledExactlyOnceWith('a1');
  });

  it('does not offer archive instead on an already archived row', () => {
    renderIntl(
      <AccountList
        {...listProps({
          showArchived: true,
          accounts: [account({ archived: true, archivedAt: '2026-10-01T00:00:00.000Z' })],
          blockedDeleteId: 'a1',
        })}
      />,
    );

    expect(screen.getByText(es.errors.accountHasMovements)).toBeDefined();
    expect(screen.queryByRole('button', { name: es.accounts.actions.archiveInstead })).toBeNull();
  });

  it('disables the view toggle while an action is pending', () => {
    renderIntl(<AccountList {...listProps({ pending: true })} />);

    expect(
      screen.getByRole('button', { name: es.accounts.list.showArchived }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('disables the rename cancel button while pending', () => {
    renderIntl(<AccountList {...listProps({ editingId: 'a1', pending: true })} />);

    expect(
      screen.getByRole('button', { name: es.accounts.actions.cancel }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('disables the delete cancel button while pending', () => {
    renderIntl(<AccountList {...listProps({ confirmingDeleteId: 'a1', pending: true })} />);

    expect(
      screen.getByRole('button', { name: es.accounts.actions.cancel }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('announces the delete confirmation as a live region', () => {
    renderIntl(<AccountList {...listProps({ confirmingDeleteId: 'a1' })} />);

    expect(screen.getByRole('status').textContent).toBe(
      es.accounts.actions.confirmDelete.replace('{name}', 'Caja'),
    );
  });

  it('shows the name length limit from the shared constant on the rename field', () => {
    renderIntl(
      <AccountList
        {...listProps({ editingId: 'a1', renameError: 'accounts.errors.nameTooLong' })}
      />,
    );

    expect(
      screen.getByText(
        es.accounts.errors.nameTooLong.replace('{max}', String(ACCOUNT_NAME_MAX_LENGTH)),
      ),
    ).toBeDefined();
  });

  it('shows an action failure in an alert', () => {
    renderIntl(<AccountList {...listProps({ actionError: 'network' })} />);

    expect(screen.getByRole('alert').textContent).toContain(es.errors.network);
  });
});
