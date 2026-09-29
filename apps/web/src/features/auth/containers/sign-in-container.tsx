'use client';

import { GOOGLE_SIGN_IN_ERRORS, signInRequestSchema, type GoogleSignInError } from '@argent/shared';
import { useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { SignInForm, type SignInFormValues } from '../components/sign-in-form';
import { toFormErrors, toValidationErrors, type FormErrors } from '../form-errors';
import { useGoogleStartUrl } from '../google-start-url';

function isGoogleSignInError(value: string | null): value is GoogleSignInError {
  return GOOGLE_SIGN_IN_ERRORS.some((known) => known === value);
}

/**
 * The API sends a failed Google sign-in back here with `?error=google_failed`. The parameter is
 * removed from the address bar so a reload does not show the error again; other values are ignored.
 */
function takeGoogleSignInError(): GoogleSignInError | null {
  const url = new URL(window.location.href);
  const error = url.searchParams.get('error');
  if (!isGoogleSignInError(error)) return null;
  url.searchParams.delete('error');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  return error;
}

export function SignInContainer() {
  const api = useApiClient();
  const router = useRouter();
  const googleStartUrl = useGoogleStartUrl();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  useEffect(() => {
    // `google_failed` is the only value (GOOGLE_SIGN_IN_ERRORS), so it maps to one message.
    if (takeGoogleSignInError() !== null) setErrors({ form: 'googleFailed' });
  }, []);

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
      googleStartUrl={googleStartUrl}
      onSubmit={(values) => {
        void signIn(values);
      }}
    />
  );
}
