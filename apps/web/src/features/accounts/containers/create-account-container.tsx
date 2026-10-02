'use client';

import {
  OPENING_BALANCE_LIMIT_MINOR_UNITS,
  createAccountRequestSchema,
  formatMinorUnitsString,
  formatMoney,
  openingBalanceSchema,
  parseAmountInput,
} from '@pesly/shared';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import type { CreateAccountInput } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { nameErrorMessage, type AccountFormErrors } from '../account-form-errors';
import { AccountForm, type AccountFormValues } from '../components/account-form';

type FieldErrors = NonNullable<AccountFormErrors['fields']>;

export function CreateAccountContainer() {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<AccountFormErrors>({});

  /** The request to send, or the per-field messages explaining why there is none. */
  function validate(
    values: AccountFormValues,
  ):
    | { request: CreateAccountInput; fields?: undefined }
    | { request?: undefined; fields: FieldErrors } {
    const fields: FieldErrors = {};

    // An empty opening balance is omitted: the API stores 0 (AC-16).
    const amountText = values.openingBalance.trim();
    let openingBalance: string | undefined;
    if (amountText !== '') {
      const minorUnits = parseAmountInput(amountText, locale);
      if (minorUnits === null) fields.openingBalance = 'accounts.errors.amountInvalid';
      else {
        const text = formatMinorUnitsString(minorUnits);
        if (openingBalanceSchema.safeParse(text).success) openingBalance = text;
        else fields.openingBalance = 'accounts.errors.amountOutOfRange';
      }
    }

    const parsed = createAccountRequestSchema.safeParse({
      name: values.name,
      type: values.type,
      currency: values.currency,
      ...(openingBalance === undefined ? {} : { openingBalance }),
    });
    if (parsed.success) {
      if (Object.keys(fields).length > 0) return { fields };
      const { name, type, currency } = parsed.data;
      return {
        request: {
          name,
          type,
          currency,
          ...(openingBalance === undefined ? {} : { openingBalance }),
        },
      };
    }
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === 'name') fields.name ??= nameErrorMessage(values.name);
      else if (field === 'type') fields.type ??= 'accounts.errors.typeRequired';
      else if (field === 'currency') fields.currency ??= 'accounts.errors.currencyRequired';
      else if (field === 'openingBalance')
        fields.openingBalance ??= 'accounts.errors.amountInvalid';
    }
    return { fields };
  }

  async function create(values: AccountFormValues) {
    const { request, fields } = validate(values);
    if (request === undefined) {
      setErrors({
        fields,
        ...(fields.openingBalance === 'accounts.errors.amountOutOfRange'
          ? {
              openingBalanceLimit: formatMoney(
                OPENING_BALANCE_LIMIT_MINOR_UNITS,
                values.currency === 'USD' ? 'USD' : 'ARS',
                locale,
              ),
            }
          : {}),
      });
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.createAccount(request);
    if (result.ok) {
      router.push('/accounts');
      return;
    }
    setPending(false);
    if (result.code === 'UNAUTHENTICATED') {
      router.replace('/sign-in');
    } else if (result.code === 'ACCOUNT_NAME_TAKEN') {
      setErrors({ fields: { name: 'errors.accountNameTaken' } });
    } else {
      // Network and unexpected failures: the form stays mounted, so the typed values stay.
      setErrors({ form: result.messageKey });
    }
  }

  return (
    <AccountForm
      pending={pending}
      errors={errors}
      onSubmit={(values) => {
        void create(values);
      }}
    />
  );
}
