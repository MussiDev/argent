'use client';

import { useTranslations } from 'next-intl';
import type { SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AuthField } from '@/features/auth/components/auth-field';
import { FormAlert } from '@/features/auth/components/form-alert';
import type { FormErrors } from '@/features/auth/form-errors';
import { readField } from '@/features/auth/read-field';
import { useFocusFirstInvalid } from '@/features/auth/use-focus-first-invalid';
import { useFocusHeading } from '../use-focus-heading';

export interface DisableTwoFactorProps {
  /** Focus the heading on mount: set when this view replaced another one. */
  focusHeading?: boolean;
  pending: boolean;
  errors: FormErrors;
  /** A TOTP code or an unused recovery code (FR-02). */
  onSubmit: (code: string) => void;
  onCancel: () => void;
}

export function DisableTwoFactor({
  focusHeading = false,
  pending,
  errors,
  onSubmit,
  onCancel,
}: DisableTwoFactorProps) {
  const t = useTranslations('security.disable');
  const headingRef = useFocusHeading(focusHeading);
  const formRef = useFocusFirstInvalid(errors);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(readField(event.currentTarget, 'code'));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" ref={headingRef} tabIndex={-1} className="outline-none">
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
          <FormAlert error={errors.form} />
          <AuthField
            label={t('code')}
            name="code"
            type="text"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={16}
            required
            error={errors.fields?.code}
          />
          <Button type="submit" disabled={pending}>
            {pending ? t('pending') : t('submit')}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t('cancel')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
