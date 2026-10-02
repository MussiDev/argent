'use client';

import type { MovementResponse } from '@pesly/shared';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants } from '@/components/ui/button';
import { FormAlert } from '@/features/auth/components/form-alert';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { Link } from '@/i18n/navigation';
import { MovementRow } from './movement-row';

/** One movement with the names of the account and category already resolved. */
export interface MovementListItem {
  movement: MovementResponse;
  accountName: string | undefined;
  currency: string | undefined;
  categoryName: string | undefined;
}

export interface MovementListProps {
  items: readonly MovementListItem[];
  timeZone: string;
  hasMore: boolean;
  loadingMore: boolean;
  /** Why the last "show more" failed; the rows already shown stay. */
  moreError: ErrorMessageKey | undefined;
  onShowMore: () => void;
}

export function MovementList({
  items,
  timeZone,
  hasMore,
  loadingMore,
  moreError,
  onShowMore,
}: MovementListProps) {
  const t = useTranslations('movements.list');

  return (
    <section className="grid gap-4">
      <div className="flex justify-end">
        <Link href="/movements/new" className={buttonVariants({ size: 'sm' })}>
          <Plus aria-hidden />
          {t('newMovement')}
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        // An explicit role: list-style reset classes can drop the implicit one in Safari.
        <ul role="list" className="grid gap-3">
          {items.map((item) => (
            <MovementRow
              key={item.movement.id}
              movement={item.movement}
              accountName={item.accountName}
              currency={item.currency}
              categoryName={item.categoryName}
              timeZone={timeZone}
            />
          ))}
        </ul>
      )}
      <FormAlert error={moreError} />
      {hasMore ? (
        <Button
          variant="outline"
          disabled={loadingMore}
          aria-busy={loadingMore}
          onClick={onShowMore}
        >
          {t('showMore')}
        </Button>
      ) : null}
    </section>
  );
}
