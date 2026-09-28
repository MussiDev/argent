'use client';

import { passwordResetRequestSchema } from '@argent/shared';
import { useState } from 'react';
import { useApiClient } from '@/lib/api-client-provider';
import {
  ForgotPasswordForm,
  type ForgotPasswordFormValues,
} from '../components/forgot-password-form';
import { toFormErrors, toValidationErrors, type FormErrors } from '../form-errors';

export function ForgotPasswordContainer() {
  const api = useApiClient();
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  async function requestReset(values: ForgotPasswordFormValues) {
    const parsed = passwordResetRequestSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(toValidationErrors(parsed.error));
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.requestPasswordReset(parsed.data);
    setPending(false);
    if (result.ok) setSent(true);
    else setErrors(toFormErrors(result));
  }

  return (
    <ForgotPasswordForm
      pending={pending}
      sent={sent}
      errors={errors}
      onSubmit={(values) => {
        void requestReset(values);
      }}
    />
  );
}
