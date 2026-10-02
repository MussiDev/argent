'use client';

import type { HoldingResponse } from '@pesly/shared';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Locale } from '@/i18n/routing';
import { formatDateTime, formatMoney, formatPercentage, formatQuantity } from '@/lib/format-amount';
import { cn } from '@/lib/utils';

export interface HoldingRowProps {
  holding: HoldingResponse;
  language: Locale;
  timeZone: string;
  onEdit?: (holdingId: string) => void;
  onSetPrice?: (holdingId: string) => void;
  onDelete?: (holdingId: string) => void;
}

function signed(text: string, amount: bigint): string {
  return amount > 0n ? `+${text}` : text;
}

export function HoldingRow({
  holding,
  language,
  timeZone,
  onEdit,
  onSetPrice,
  onDelete,
}: HoldingRowProps) {
  const t = useTranslations('investments');
  const [open, setOpen] = useState(false);
  const detailsId = useId();

  // A newer API may send a type or source this build does not know; show its raw key.
  const typeLabel = t.has(`instrumentTypes.${holding.instrumentType}`)
    ? t(`instrumentTypes.${holding.instrumentType}`)
    : holding.instrumentType;
  const sourceLabel =
    holding.priceSource === null
      ? null
      : t.has(`priceSources.${holding.priceSource}`)
        ? t(`priceSources.${holding.priceSource}`)
        : holding.priceSource;

  const gainAmount = holding.gain === null ? 0n : BigInt(holding.gain.amount);
  const isLoss = gainAmount < 0n;
  const pricedAt =
    holding.pricedAt === null ? null : formatDateTime(holding.pricedAt, timeZone, language);
  const currency = holding.valuationCurrency;

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-col">
          <span className="font-medium">{holding.ticker}</span>
          <span className="truncate text-sm text-muted-foreground">{holding.instrumentName}</span>
          <span className="text-xs text-muted-foreground">{typeLabel}</span>
          <span className="text-xs text-muted-foreground">
            {t('holding.quantity', {
              quantity: formatQuantity(BigInt(holding.quantity), language),
            })}
          </span>
        </div>
        <div className="flex flex-col items-end text-right">
          {holding.value === null ? (
            <span className="text-sm text-muted-foreground">{t('holding.priceNeeded')}</span>
          ) : (
            <span className="font-medium">
              {formatMoney(BigInt(holding.value), currency, language)}
            </span>
          )}
          {holding.gain !== null && (
            <span className={cn('text-xs', isLoss ? 'text-destructive' : 'text-foreground')}>
              {t(isLoss ? 'holding.loss' : 'holding.gain', {
                amount: signed(formatMoney(gainAmount, currency, language), gainAmount),
                percent: signed(
                  formatPercentage(BigInt(holding.gain.basisPoints), language),
                  gainAmount,
                ),
              })}
            </span>
          )}
          {holding.priceStale && pricedAt !== null && (
            <span className="text-xs text-muted-foreground">
              {t('holding.stalePrice', { date: pricedAt })}
            </span>
          )}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        aria-expanded={open}
        aria-controls={open ? detailsId : undefined}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <ChevronDown aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
        <span className="sr-only">
          {open
            ? t('holding.hideDetailsFor', { ticker: holding.ticker })
            : t('holding.showDetailsFor', { ticker: holding.ticker })}
        </span>
        <span aria-hidden>{open ? t('holding.hideDetails') : t('holding.showDetails')}</span>
      </Button>
      {open && (
        <div id={detailsId} className="flex flex-col gap-3 rounded-md border p-3 text-sm">
          {holding.unitPrice === null ? (
            <p className="text-muted-foreground">{t('holding.noPrice')}</p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">{t('holding.unitPrice')}</dt>
              <dd>{formatMoney(BigInt(holding.unitPrice), currency, language)}</dd>
              {sourceLabel !== null && (
                <>
                  <dt className="text-muted-foreground">{t('holding.priceSource')}</dt>
                  <dd>{sourceLabel}</dd>
                </>
              )}
              {pricedAt !== null && (
                <>
                  <dt className="text-muted-foreground">{t('holding.pricedAt')}</dt>
                  <dd>{pricedAt}</dd>
                </>
              )}
            </dl>
          )}
          {(onEdit !== undefined || onSetPrice !== undefined || onDelete !== undefined) && (
            <div className="flex flex-wrap gap-2">
              {onEdit !== undefined && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t('holding.editFor', { ticker: holding.ticker })}
                  onClick={() => {
                    onEdit(holding.id);
                  }}
                >
                  {t('holding.edit')}
                </Button>
              )}
              {onSetPrice !== undefined && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t('holding.setPriceFor', { ticker: holding.ticker })}
                  onClick={() => {
                    onSetPrice(holding.id);
                  }}
                >
                  {t('holding.setPrice')}
                </Button>
              )}
              {onDelete !== undefined && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t('holding.deleteFor', { ticker: holding.ticker })}
                  onClick={() => {
                    onDelete(holding.id);
                  }}
                >
                  {t('holding.delete')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
