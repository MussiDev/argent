'use client';

import { ACCOUNT_CURRENCIES, type AccountResponse } from '@pesly/shared';
import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { FormAlert } from '@/features/auth/components/form-alert';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { Link } from '@/i18n/navigation';
import type { AccountFieldMessage } from '../account-form-errors';
import { formatAmount } from '../format-amount';
import type { CurrencyTotals } from '../totals';
import { AccountRow } from './account-row';
import { AccountsHeadline } from './accounts-headline';

export interface AccountListProps {
  accounts: readonly AccountResponse[];
  /** Per currency, minor-unit strings from the API; shown on the active view only. */
  availableTotals: CurrencyTotals;
  netWorthTotals: CurrencyTotals;
  debtTotals: CurrencyTotals;
  /** Active credit cards across all pages: the Debt section shows when it is above 0. */
  creditCardCount: number;
  showArchived: boolean;
  /** An action is in flight: the row buttons wait. */
  pending: boolean;
  editingId: string | undefined;
  confirmingDeleteId: string | undefined;
  /** The API refused to delete this account because it has movements. */
  blockedDeleteId: string | undefined;
  renameError: AccountFieldMessage | undefined;
  actionError: ErrorMessageKey | undefined;
  onToggleArchived: () => void;
  onToggleAvailable: (id: string, value: boolean) => void;
  onStartRename: (id: string) => void;
  onCancelRename: () => void;
  onRename: (id: string, name: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onAskDelete: (id: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (id: string) => void;
}

interface DebtSectionProps {
  cards: readonly AccountResponse[];
  debtTotals: CurrencyTotals;
  renderRow: (account: AccountResponse) => ReactNode;
}

function DebtSection({ cards, debtTotals, renderRow }: DebtSectionProps) {
  const t = useTranslations('accounts');
  const locale = useLocale();
  const titleId = useId();
  // A currency shows when it owes something or a listed card uses it.
  const currencies = ACCOUNT_CURRENCIES.filter(
    (currency) =>
      (debtTotals[currency] ?? '0') !== '0' || cards.some((card) => card.currency === currency),
  );

  return (
    <section aria-labelledby={titleId} className="grid gap-3">
      <h3 id={titleId} className="text-base font-semibold">
        {t('debt.title')}
      </h3>
      {currencies.length === 0 ? null : (
        <dl className="grid gap-2 rounded-lg border bg-card p-4 text-card-foreground">
          {currencies.map((currency) => (
            <div key={currency} className="flex items-center justify-between gap-2">
              <dt className="text-sm text-muted-foreground">{t(`currencies.${currency}`)}</dt>
              <dd className="font-semibold tabular-nums">
                {formatAmount(debtTotals[currency] ?? '0', currency, locale)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {cards.length === 0 ? null : <ul className="grid gap-3">{cards.map(renderRow)}</ul>}
    </section>
  );
}

/**
 * Active view: the Available / Net worth headline, the accounts that hold money and, when the user
 * has credit cards, the Debt section. Archived view: one flat list with no totals or setting.
 */
export function AccountList(props: AccountListProps) {
  const {
    accounts,
    availableTotals,
    netWorthTotals,
    debtTotals,
    creditCardCount,
    showArchived,
    pending,
    editingId,
    confirmingDeleteId,
    blockedDeleteId,
    renameError,
    actionError,
  } = props;
  const t = useTranslations('accounts');

  function renderRow(account: AccountResponse) {
    return (
      <AccountRow
        key={account.id}
        onToggleAvailable={props.onToggleAvailable}
        onStartRename={props.onStartRename}
        onCancelRename={props.onCancelRename}
        onRename={props.onRename}
        onArchive={props.onArchive}
        onUnarchive={props.onUnarchive}
        onAskDelete={props.onAskDelete}
        onCancelDelete={props.onCancelDelete}
        onConfirmDelete={props.onConfirmDelete}
        account={account}
        pending={pending}
        editing={editingId === account.id}
        confirmingDelete={confirmingDeleteId === account.id}
        blockedDelete={blockedDeleteId === account.id}
        renameError={renameError}
      />
    );
  }

  const cards = showArchived ? [] : accounts.filter((account) => account.type === 'credit_card');
  const others = showArchived ? accounts : accounts.filter((a) => a.type !== 'credit_card');
  const showDebt = !showArchived && creditCardCount > 0;
  const isEmpty = accounts.length === 0 && !showDebt;

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {showArchived ? t('list.archivedTitle') : t('list.activeTitle')}
        </h2>
        <Link href="/accounts/new" className={buttonVariants({ size: 'sm' })}>
          <Plus aria-hidden />
          {t('list.newAccount')}
        </Link>
      </div>
      <FormAlert error={actionError} />
      {showArchived ? null : (
        <AccountsHeadline availableTotals={availableTotals} netWorthTotals={netWorthTotals} />
      )}
      {isEmpty ? (
        <p className="text-sm text-muted-foreground">
          {showArchived ? t('list.emptyArchived') : t('list.empty')}
        </p>
      ) : null}
      {others.length === 0 ? null : <ul className="grid gap-3">{others.map(renderRow)}</ul>}
      {showDebt ? (
        <DebtSection cards={cards} debtTotals={debtTotals} renderRow={renderRow} />
      ) : null}
      <Button variant="outline" disabled={pending} onClick={props.onToggleArchived}>
        {showArchived ? t('list.showActive') : t('list.showArchived')}
      </Button>
    </section>
  );
}
