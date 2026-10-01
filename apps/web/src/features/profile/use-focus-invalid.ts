'use client';

import { useEffect, useRef } from 'react';
import type { ProfileFormErrors } from './profile-errors';

/** After a failed submit, moves focus to the first invalid field so its error is announced. */
export function useFocusInvalid(errors: ProfileFormErrors) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!errors.fields) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);
  return formRef;
}
