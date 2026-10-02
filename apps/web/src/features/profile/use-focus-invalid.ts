'use client';

import { useEffect, useRef } from 'react';

/**
 * After a failed submit, moves focus to the first invalid field so its error is announced. Any
 * form-error shape with an optional `fields` map works (profile, categories).
 */
export function useFocusInvalid(errors: { fields?: object }) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!errors.fields) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);
  return formRef;
}
