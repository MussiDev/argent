'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormAlert } from '@/features/auth/components/form-alert';
import type { ErrorMessageKey } from '@/features/auth/form-errors';

export interface DeleteUserGoogleProps {
  pending: boolean;
  /** Google did not confirm it is the user (the API sent the browser back with a failure flag). */
  failed: boolean;
  /** An API failure of the start or of the deletion, such as an expired confirmation. */
  error?: ErrorMessageKey;
  onStart: () => void;
}

/** The first step for an account without a password: confirm with Google before deleting. */
export function DeleteUserGoogle({ pending, failed, error, onStart }: DeleteUserGoogleProps) {
  const t = useTranslations('deleteUser');
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('warningTitle')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">{t('google.description')}</p>
        {failed ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{t('google.failed')}</AlertDescription>
          </Alert>
        ) : null}
        <FormAlert error={error} />
        <Button type="button" variant="outline" disabled={pending} onClick={onStart}>
          {pending ? t('google.pending') : t('google.continue')}
        </Button>
      </CardContent>
    </Card>
  );
}
