'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/features/auth/components/form-alert';
import type { ErrorMessageKey } from '@/features/auth/form-errors';

export type CategoriesLoadState = { kind: 'loading' } | { kind: 'failed'; error: ErrorMessageKey };

/** The list while it loads, or why it could not load (offline included) with a retry. */
export function CategoriesLoadStateView({
  state,
  onRetry,
}: {
  state: CategoriesLoadState;
  onRetry: () => void;
}) {
  const t = useTranslations('app');

  if (state.kind === 'loading') {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <FormAlert error={state.error} />
      <Button variant="outline" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  );
}
