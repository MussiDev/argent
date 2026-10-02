'use client';

import { formatMoney, type MovementResponse } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { formatRate } from '../format-rate';

export interface MovementRowProps {
  movement: MovementResponse;
  /** `undefined` when the account is not in the loaded sets: a neutral placeholder shows. */
  accountName: string | undefined;
  currency: string | undefined;
  categoryName: string | undefined;
  timeZone: string;
}

/** ISO 4217's "no currency" code: it formats the amount with a neutral sign. */
const UNKNOWN_CURRENCY = 'XXX';

const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const formatters = new Map<string, Intl.DateTimeFormat>();

/** One formatter per locale and zone, shared by every row; an invalid zone uses the default. */
function dateTimeFormat(locale: string, timeZone: string): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}`;
  const cached = formatters.get(key);
  if (cached !== undefined) return cached;
  const options = { dateStyle: 'medium', timeStyle: 'short' } as const;
  let created: Intl.DateTimeFormat;
  try {
    created = new Intl.DateTimeFormat(locale, { ...options, timeZone });
  } catch (error) {
    // Only a RangeError means a bad zone; anything else is a real failure.
    if (!(error instanceof RangeError)) throw error;
    created = new Intl.DateTimeFormat(locale, { ...options, timeZone: DEFAULT_TIME_ZONE });
  }
  formatters.set(key, created);
  return created;
}

export function MovementRow({
  movement,
  accountName,
  currency,
  categoryName,
  timeZone,
}: MovementRowProps) {
  const t = useTranslations('movements.list');
  const locale = useLocale();
  const minor = BigInt(movement.amount);
  const signed = movement.type === 'expense' ? -minor : minor;
  // The neutral code applies only when the account is not among the loaded ones.
  const amount = formatMoney(signed, currency ?? UNKNOWN_CURRENCY, locale);
  const when = dateTimeFormat(locale, timeZone).format(new Date(movement.occurredAt));

  return (
    <li className="grid gap-1 rounded-lg border bg-card p-4 text-card-foreground">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{categoryName ?? t('unknownCategory')}</span>
        <span
          className={
            movement.type === 'expense'
              ? 'font-semibold tabular-nums'
              : 'font-semibold tabular-nums text-primary'
          }
        >
          {movement.type === 'income' ? `+${amount}` : amount}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{accountName ?? t('unknownAccount')}</p>
      <p className="text-sm text-muted-foreground">
        <time dateTime={movement.occurredAt}>{when}</time>
      </p>
      {movement.note === null ? null : <p className="text-sm">{movement.note}</p>}
      <p className="text-xs text-muted-foreground">
        {t('rate', { rate: formatRate(BigInt(movement.rate), locale) })}
      </p>
    </li>
  );
}
