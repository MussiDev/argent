'use client';

import { useEffect, useRef } from 'react';
import type { FormErrors } from './form-errors';

/**
 * After a failed submit, moves focus to the first invalid field so screen readers announce it
 * together with its error (the field's `aria-describedby` points at the message).
 */
export function useFocusFirstInvalid(errors: FormErrors) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!errors.fields) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);
  return formRef;
}
