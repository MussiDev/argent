'use client';

import { useTranslations } from 'next-intl';
import type { SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import type { FormErrors } from '../form-errors';
import { readField } from '../read-field';
import { useFocusFirstInvalid } from '../use-focus-first-invalid';
import { AuthField } from './auth-field';
import { FormAlert } from './form-alert';

export interface SignInFormValues {
  email: string;
  password: string;
}

export interface SignInFormProps {
  pending: boolean;
  errors: FormErrors;
  onSubmit: (values: SignInFormValues) => void;
}

export function SignInForm({ pending, errors, onSubmit }: SignInFormProps) {
  const t = useTranslations('auth');
  const formRef = useFocusFirstInvalid(errors);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      email: readField(event.currentTarget, 'email'),
      password: readField(event.currentTarget, 'password'),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('signIn.title')}</CardTitle>
        <CardDescription>{t('signIn.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
          <FormAlert error={errors.form} />
          <AuthField
            label={t('fields.email')}
            name="email"
            type="email"
            autoComplete="email"
            required
            error={errors.fields?.email}
          />
          <AuthField
            label={t('fields.password')}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            error={errors.fields?.password}
          />
          <Button type="submit" disabled={pending}>
            {pending ? t('signIn.pending') : t('signIn.submit')}
          </Button>
          <Link
            href="/forgot-password"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {t('signIn.forgotPassword')}
          </Link>
          <p className="text-sm text-muted-foreground">
            {t('signIn.noAccount')}{' '}
            <Link href="/register" className="text-primary underline-offset-4 hover:underline">
              {t('signIn.registerLink')}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
