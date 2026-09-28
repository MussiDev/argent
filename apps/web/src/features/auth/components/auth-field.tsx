'use client';

import { useTranslations } from 'next-intl';
import type { ComponentProps } from 'react';
import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import type { ErrorMessageKey } from '../form-errors';

interface AuthFieldProps extends ComponentProps<typeof FormControl> {
  label: string;
  description?: string;
  error: ErrorMessageKey | undefined;
}

/** A labelled input with its hint and its inline error, as every auth form lays them out. */
export function AuthField({ label, description, error, ...inputProps }: AuthFieldProps) {
  const t = useTranslations('errors');
  return (
    <FormItem invalid={Boolean(error)} hasDescription={Boolean(description)}>
      <FormLabel>{label}</FormLabel>
      <FormControl {...inputProps} />
      {description ? <FormDescription>{description}</FormDescription> : null}
      <FormMessage>{error ? t(error) : null}</FormMessage>
    </FormItem>
  );
}
