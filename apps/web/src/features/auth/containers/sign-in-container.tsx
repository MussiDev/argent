'use client';

import { signInRequestSchema } from '@argent/shared';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { SignInForm, type SignInFormValues } from '../components/sign-in-form';
import { toFormErrors, toValidationErrors, type FormErrors } from '../form-errors';

export function SignInContainer() {
  const api = useApiClient();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  async function signIn(values: SignInFormValues) {
    const parsed = signInRequestSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(toValidationErrors(parsed.error));
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.signIn(parsed.data);
    if (!result.ok) {
      setPending(false);
      setErrors(toFormErrors(result));
      return;
    }
    const { user } = result.data;
    // The app opens in the account's language (FR-11); unverified accounts go to verification.
    router.replace(user.emailVerified ? '/' : '/check-your-email', { locale: user.language });
  }

  return (
    <SignInForm
      pending={pending}
      errors={errors}
      onSubmit={(values) => {
        void signIn(values);
      }}
    />
  );
}
