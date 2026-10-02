'use client';

import { useEffect, useRef } from 'react';
import type { FocusRequest } from './use-field-errors';

/**
 * Moves focus to the first invalid field when the API sends field errors and after each failed
 * submit, so the error is announced; with no invalid field, to the form-level error if the form
 * itself raised one.
 */
export function useFocusInvalid({ api, attempt, formError }: FocusRequest) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const target =
      form.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      (formError ? form.querySelector<HTMLElement>('[data-form-error]') : null);
    target?.focus();
  }, [api, attempt, formError]);
  return formRef;
}
