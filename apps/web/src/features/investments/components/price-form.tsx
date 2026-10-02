'use client';

import { setPriceRequestSchema, type SetPriceRequest } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import type { SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormControl, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { readField } from '@/features/auth/read-field';
import type { Locale } from '@/i18n/routing';
import { parseAmountInput } from '../decimal-input';
import { decimalErrorKey, type HoldingFormErrors } from '../holding-form-errors';
import { useFieldErrors } from '../use-field-errors';
import { useFocusInvalid } from '../use-focus-invalid';
import { FormErrorAlert } from './form-error-alert';

export interface PriceFormProps {
  /** The language the price is typed in (decimal separator). */
  language: Locale;
  /** While true the form ignores submits and shows its pending label. */
  pending: boolean;
  /** API failure of the last request, from `toHoldingFailure(failure, 'price')`. */
  errors?: HoldingFormErrors;
  /** The price in minor units, as the API expects it, already validated with the shared schema. */
  onSubmit: (values: SetPriceRequest) => void;
  onCancel?: () => void;
}

/** A manual unit price typed in the user's language. */
export function PriceForm({ language, pending, errors, onSubmit, onCancel }: PriceFormProps) {
  const t = useTranslations('investments.forms');
  const tErrors = useTranslations('investments.errors');
  const { fields, form, focus, setLocal } = useFieldErrors(errors);
  const formRef = useFocusInvalid(focus);
  const priceError = fields.unitPrice;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = parseAmountInput(readField(event.currentTarget, 'unitPrice'), language);
    if (!parsed.ok) {
      setLocal({ unitPrice: decimalErrorKey(parsed.error) });
      return;
    }
    // The typed text is a valid number; what the schema can still reject is the allowed range.
    const request = setPriceRequestSchema.safeParse({ unitPrice: parsed.value });
    if (!request.success) {
      setLocal({ unitPrice: 'amountInvalid' });
      return;
    }
    setLocal({});
    onSubmit(request.data);
  }

  return (
    <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
      <FormErrorAlert error={form} />
      <FormItem invalid={Boolean(priceError)}>
        <FormLabel>{t('price.unitPrice')}</FormLabel>
        <FormControl name="unitPrice" inputMode="decimal" autoComplete="off" />
        <FormMessage>{priceError ? tErrors(priceError) : null}</FormMessage>
      </FormItem>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t('price.pending') : t('price.submit')}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
