'use client';

import {
  formatMoney,
  exactIntegerStringSchema,
  ACCOUNT_CURRENCIES,
  ACCOUNT_NAME_MAX_LENGTH,
  type AccountCurrency,
  type AccountResponse,
} from '@argent/shared';
import { CircleAlert, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, type SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormAlert } from '@/features/auth/components/form-alert';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { readField } from '@/features/auth/read-field';
import { Link } from '@/i18n/navigation';
import type { AccountFieldMessage } from '../account-form-errors';

export interface AccountListProps {
  accounts: readonly AccountResponse[];
  /** Sum of the active accounts per currency, as minor-unit strings; shown on the active view. */
  totals: Partial<Record<AccountCurrency, string>>;
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
  onStartRename: (id: string) => void;
  onCancelRename: () => void;
  onRename: (id: string, name: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onAskDelete: (id: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (id: string) => void;
}

interface RenameFormProps {
  account: AccountResponse;
  pending: boolean;
  error: AccountFieldMessage | undefined;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

function RenameForm({ account, pending, error, onSubmit, onCancel }: RenameFormProps) {
  const t = useTranslations('accounts');
  const tAll = useTranslations();
  const messageId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(readField(event.currentTarget, 'name'));
  }

  return (
    <form className="grid gap-2" noValidate onSubmit={handleSubmit}>
      <Input
        ref={inputRef}
        name="name"
        type="text"
        autoComplete="off"
        defaultValue={account.name}
        aria-label={t('actions.renameField', { name: account.name })}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? messageId : undefined}
      />
      {error ? (
        <p id={messageId} className="text-sm text-destructive">
          {tAll(error, { max: ACCOUNT_NAME_MAX_LENGTH })}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t('actions.save')}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onCancel}>
          {t('actions.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** Active or archived accounts with their balances, the active totals and the row actions. */
export function AccountList(props: AccountListProps) {
  const {
    accounts,
    totals,
    showArchived,
    pending,
    editingId,
    confirmingDeleteId,
    blockedDeleteId,
    renameError,
    actionError,
  } = props;
  const t = useTranslations('accounts');
  const tErrors = useTranslations('errors');
  const locale = useLocale();

  function money(amount: string, currency: AccountCurrency): string {
    return formatMoney(BigInt(exactIntegerStringSchema.parse(amount)), currency, locale);
  }

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
        <div
          role="group"
          aria-label={t('list.totals')}
          className="grid gap-2 rounded-lg border bg-card p-4 text-card-foreground"
        >
          <dl className="grid gap-2">
            {ACCOUNT_CURRENCIES.map((currency) => (
              <div key={currency} className="flex items-center justify-between gap-2">
                <dt className="text-sm text-muted-foreground">{t(`totals.${currency}`)}</dt>
                <dd className="font-semibold tabular-nums">
                  {money(totals[currency] ?? '0', currency)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {showArchived ? t('list.emptyArchived') : t('list.empty')}
        </p>
      ) : (
        <ul className="grid gap-3">
          {accounts.map((account) => (
            <li
              key={account.id}
              aria-label={account.name}
              className="grid gap-3 rounded-lg border bg-card p-4 text-card-foreground"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium break-words">{account.name}</p>
                  <p className="text-sm text-muted-foreground">{t(`types.${account.type}`)}</p>
                </div>
                <p className="font-semibold tabular-nums">
                  {money(account.balance, account.currency)}
                </p>
              </div>
              {editingId === account.id ? (
                <RenameForm
                  account={account}
                  pending={pending}
                  error={renameError}
                  onSubmit={(name) => {
                    props.onRename(account.id, name);
                  }}
                  onCancel={props.onCancelRename}
                />
              ) : confirmingDeleteId === account.id ? (
                <div className="grid gap-2">
                  <p role="status" className="text-sm">
                    {t('actions.confirmDelete', { name: account.name })}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      disabled={pending}
                      onClick={() => {
                        props.onConfirmDelete(account.id);
                      }}
                    >
                      {t('actions.confirmDeleteYes')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={props.onCancelDelete}
                    >
                      {t('actions.cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {blockedDeleteId === account.id ? (
                    <Alert variant="destructive">
                      <CircleAlert aria-hidden />
                      <AlertDescription>
                        {tErrors('accountHasMovements')}
                        {account.archived ? null : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => {
                              props.onArchive(account.id);
                            }}
                          >
                            {t('actions.archiveInstead')}
                          </Button>
                        )}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        props.onStartRename(account.id);
                      }}
                    >
                      {t('actions.rename')}
                      <span className="sr-only"> {account.name}</span>
                    </Button>
                    {account.archived ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          props.onUnarchive(account.id);
                        }}
                      >
                        {t('actions.unarchive')}
                        <span className="sr-only"> {account.name}</span>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          props.onArchive(account.id);
                        }}
                      >
                        {t('actions.archive')}
                        <span className="sr-only"> {account.name}</span>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        props.onAskDelete(account.id);
                      }}
                    >
                      {t('actions.delete')}
                      <span className="sr-only"> {account.name}</span>
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button variant="outline" disabled={pending} onClick={props.onToggleArchived}>
        {showArchived ? t('list.showActive') : t('list.showArchived')}
      </Button>
    </section>
  );
}
