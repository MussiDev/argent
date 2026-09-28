'use client';

import { CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import type { FormErrors } from '../form-errors';
import { readField } from '../read-field';
import { useFocusFirstInvalid } from '../use-focus-first-invalid';
import { AuthField } from './auth-field';
import { FormAlert } from './form-alert';

export interface ResetPasswordFormValues {
  newPassword: string;
}

export interface ResetPasswordFormProps {
  pending: boolean;
  errors: FormErrors;
  /** The password was changed; the form gives way to the confirmation. */
  done?: boolean;
  onSubmit: (values: ResetPasswordFormValues) => void;
}

export function ResetPasswordForm({
  pending,
  errors,
  done = false,
  onSubmit,
}: ResetPasswordFormProps) {
  const t = useTranslations('auth');
  const formRef = useFocusFirstInvalid(errors);
  const linkInvalid = errors.form === 'tokenInvalid';

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({ newPassword: readField(event.currentTarget, 'newPassword') });
  }

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h1">{t('resetPassword.successTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Alert role="status">
            <CircleCheck aria-hidden />
            <AlertDescription>{t('resetPassword.success')}</AlertDescription>
          </Alert>
          <Link href="/sign-in" className={buttonVariants()}>
            {t('resetPassword.signInLink')}
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('resetPassword.title')}</CardTitle>
        <CardDescription>{t('resetPassword.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FormAlert error={errors.form} />
        {linkInvalid ? (
          // AC-11: an expired or used link offers to request a new one.
          <Link href="/forgot-password" className={buttonVariants({ variant: 'outline' })}>
            {t('resetPassword.requestNewLink')}
          </Link>
        ) : (
          <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
            <AuthField
              label={t('fields.newPassword')}
              description={t('passwordHint')}
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              error={errors.fields?.newPassword}
            />
            <Button type="submit" disabled={pending}>
              {pending ? t('resetPassword.pending') : t('resetPassword.submit')}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
