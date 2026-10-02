'use client';

import { createPortfolioRequestSchema, type CreatePortfolioRequest } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import type { SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormControl, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { readField } from '@/features/auth/read-field';
import type { HoldingFormErrors } from '../holding-form-errors';
import { useFieldErrors } from '../use-field-errors';
import { useFocusInvalid } from '../use-focus-invalid';
import { FormErrorAlert } from './form-error-alert';

export interface CreatePortfolioFormProps {
  /** While true the form ignores submits and shows its pending label. */
  pending: boolean;
  /** API failure of the last request, from `toHoldingFailure(failure, 'portfolio')`. */
  errors?: HoldingFormErrors;
  /** The trimmed name, already validated with the shared request schema. */
  onSubmit: (values: CreatePortfolioRequest) => void;
  onCancel?: () => void;
}

/** The name of a new portfolio, 1 to 60 characters. */
export function CreatePortfolioForm({
  pending,
  errors,
  onSubmit,
  onCancel,
}: CreatePortfolioFormProps) {
  const t = useTranslations('investments.forms');
  const tErrors = useTranslations('investments.errors');
  const { fields, form, focus, setLocal } = useFieldErrors(errors);
  const formRef = useFocusInvalid(focus);
  const nameError = fields.name;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = createPortfolioRequestSchema.safeParse({
      name: readField(event.currentTarget, 'name'),
    });
    if (!parsed.success) {
      const tooLong = parsed.error.issues.some((issue) => issue.code === 'too_big');
      setLocal({ name: tooLong ? 'nameTooLong' : 'nameRequired' });
      return;
    }
    setLocal({});
    onSubmit(parsed.data);
  }

  return (
    <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
      <FormErrorAlert error={form} />
      <FormItem invalid={Boolean(nameError)}>
        <FormLabel>{t('createPortfolio.name')}</FormLabel>
        <FormControl name="name" autoComplete="off" />
        <FormMessage>{nameError ? tErrors(nameError) : null}</FormMessage>
      </FormItem>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t('createPortfolio.pending') : t('createPortfolio.submit')}
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
