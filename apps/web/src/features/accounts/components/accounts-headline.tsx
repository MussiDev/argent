'use client';

import { ACCOUNT_CURRENCIES } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { formatAmount } from '../format-amount';
import type { CurrencyTotals } from '../totals';

export interface AccountsHeadlineProps {
  /** Minor-unit strings per currency: what the user can spend (included accounts). */
  availableTotals: CurrencyTotals;
  /** Minor-unit strings per currency: every active account, card debt included. */
  netWorthTotals: CurrencyTotals;
}

/** Per currency, Available as the main figure and Net worth as the smaller secondary one. */
export function AccountsHeadline({ availableTotals, netWorthTotals }: AccountsHeadlineProps) {
  const t = useTranslations('accounts');
  const locale = useLocale();

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {ACCOUNT_CURRENCIES.map((currency) => (
        <div
          key={currency}
          role="group"
          aria-label={t(`currencies.${currency}`)}
          className="grid gap-2 rounded-lg border bg-card p-4 text-card-foreground"
        >
          <dl className="grid gap-2">
            <div className="grid gap-1">
              <dt className="text-sm text-muted-foreground">{t('headline.available')}</dt>
              <dd className="text-3xl font-semibold tabular-nums">
                {formatAmount(availableTotals[currency] ?? '0', currency, locale)}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-sm text-muted-foreground">{t('headline.netWorth')}</dt>
              <dd className="text-sm font-medium tabular-nums">
                {formatAmount(netWorthTotals[currency] ?? '0', currency, locale)}
              </dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}
