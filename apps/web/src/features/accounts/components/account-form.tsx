'use client';

import { ACCOUNT_CURRENCIES, ACCOUNT_TYPES } from '@argent/shared';
import { useTranslations } from 'next-intl';
import type { SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormAlert } from '@/features/auth/components/form-alert';
import { readField } from '@/features/auth/read-field';
import { Link } from '@/i18n/navigation';
import type { AccountFormErrors } from '../account-form-errors';
import { useFocusFirstInvalid } from '../use-focus-first-invalid';
import { AccountField } from './account-field';

/** What the user typed or picked, untouched: the container parses and validates it. */
export interface AccountFormValues {
  name: string;
  type: string;
  currency: string;
  openingBalance: string;
}

export interface AccountFormProps {
  pending: boolean;
  errors: AccountFormErrors;
  onSubmit: (values: AccountFormValues) => void;
}

export function AccountForm({ pending, errors, onSubmit }: AccountFormProps) {
  const t = useTranslations('accounts');
  const formRef = useFocusFirstInvalid(errors);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSubmit({
      name: readField(form, 'name'),
      type: readField(form, 'type'),
      currency: readField(form, 'currency'),
      openingBalance: readField(form, 'openingBalance'),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('new.title')}</CardTitle>
        <CardDescription>{t('new.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
          <FormAlert error={errors.form} />
          <AccountField label={t('fields.name')} error={errors.fields?.name}>
            {(control) => (
              <Input name="name" type="text" autoComplete="off" required {...control} />
            )}
          </AccountField>
          <AccountField label={t('fields.type')} error={errors.fields?.type}>
            {(control) => (
              <Select name="type" defaultValue="" required {...control}>
                <option value="">{t('fields.typePlaceholder')}</option>
                {ACCOUNT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`types.${type}`)}
                  </option>
                ))}
              </Select>
            )}
          </AccountField>
          <AccountField label={t('fields.currency')} error={errors.fields?.currency}>
            {(control) => (
              <Select name="currency" defaultValue="" required {...control}>
                <option value="">{t('fields.currencyPlaceholder')}</option>
                {ACCOUNT_CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {t(`currencies.${currency}`)}
                  </option>
                ))}
              </Select>
            )}
          </AccountField>
          <AccountField
            label={t('fields.openingBalance')}
            hint={t('fields.openingBalanceHint')}
            error={errors.fields?.openingBalance}
            max={errors.openingBalanceLimit}
          >
            {(control) => (
              <Input
                name="openingBalance"
                type="text"
                autoComplete="off"
                defaultValue="0"
                {...control}
              />
            )}
          </AccountField>
          <Button type="submit" disabled={pending}>
            {pending ? t('form.pending') : t('form.submit')}
          </Button>
          <Link
            href="/accounts"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {t('form.back')}
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
