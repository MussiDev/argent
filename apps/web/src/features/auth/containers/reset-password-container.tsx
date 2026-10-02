'use client';

import { passwordResetConfirmRequestSchema } from '@pesly/shared';
import { useEffect, useRef, useState } from 'react';
import { useApiClient } from '@/lib/api-client-provider';
import { ResetPasswordForm, type ResetPasswordFormValues } from '../components/reset-password-form';
import { toFormErrors, toValidationErrors, type FormErrors } from '../form-errors';
import { takeUrlToken } from '../take-url-token';

export function ResetPasswordContainer() {
  const api = useApiClient();
  const token = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  useEffect(() => {
    // Runs again on React's development remount: the token must be taken only once.
    if (token.current !== null) return;
    token.current = takeUrlToken() ?? '';
    if (!token.current) setErrors({ form: 'tokenInvalid' });
  }, []);

  async function confirm(values: ResetPasswordFormValues) {
    const parsed = passwordResetConfirmRequestSchema.safeParse({
      token: token.current ?? '',
      newPassword: values.newPassword,
    });
    if (!parsed.success) {
      setErrors(toValidationErrors(parsed.error));
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.confirmPasswordReset(parsed.data);
    setPending(false);
    if (result.ok) setDone(true);
    else setErrors(toFormErrors(result, 'newPassword'));
  }

  return (
    <ResetPasswordForm
      pending={pending}
      done={done}
      errors={errors}
      onSubmit={(values) => {
        void confirm(values);
      }}
    />
  );
}
