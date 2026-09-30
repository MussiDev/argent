'use client';

import { registerRequestSchema } from '@argent/shared';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { readDeviceContext } from '@/lib/device-context';
import { RegisterForm, type RegisterFormValues } from '../components/register-form';
import { toFormErrors, toValidationErrors, type FormErrors } from '../form-errors';
import { useGoogleStartUrl } from '../google-start-url';

export function RegisterContainer() {
  const api = useApiClient();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const googleStartUrl = useGoogleStartUrl();

  async function register(values: RegisterFormValues) {
    // FR-10 / FR-11: the account starts in the device's time zone and language.
    const parsed = registerRequestSchema.safeParse({ ...values, ...readDeviceContext() });
    if (!parsed.success) {
      setErrors(toValidationErrors(parsed.error));
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.register(parsed.data);
    if (result.ok) {
      // Same confirmation for new and already registered emails (AC-03).
      router.push('/check-your-email');
      return;
    }
    setPending(false);
    setErrors(toFormErrors(result));
  }

  return (
    <RegisterForm
      pending={pending}
      errors={errors}
      googleStartUrl={googleStartUrl}
      onSubmit={(values) => {
        void register(values);
      }}
    />
  );
}
