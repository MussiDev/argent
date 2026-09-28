'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { ErrorMessageKey } from '../form-errors';

/** The form-level error, if any, in the user's language. */
export function FormAlert({ error }: { error: ErrorMessageKey | undefined }) {
  const t = useTranslations('errors');
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>{t(error)}</AlertDescription>
    </Alert>
  );
}
