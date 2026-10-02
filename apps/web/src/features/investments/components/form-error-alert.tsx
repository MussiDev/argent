'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { InvestmentErrorKey } from '../holding-form-errors';

/**
 * The form-level error of an investments form, if any, in the user's language. It can take focus
 * (`data-form-error`) when the form raises the error itself and no field is to blame.
 */
export function FormErrorAlert({ error }: { error: InvestmentErrorKey | undefined }) {
  const t = useTranslations('investments.errors');
  if (!error) return null;
  return (
    <Alert variant="destructive" tabIndex={-1} data-form-error>
      <CircleAlert aria-hidden />
      <AlertDescription>{t(error)}</AlertDescription>
    </Alert>
  );
}
