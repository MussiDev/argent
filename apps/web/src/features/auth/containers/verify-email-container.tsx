'use client';

import { verifyEmailRequestSchema } from '@pesly/shared';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import {
  VerifyEmailNotice,
  VerifyEmailStatus,
  type ResendStatus,
  type VerificationStatus,
} from '../components/verify-email-notice';
import { toFormErrors, type FormErrors } from '../form-errors';
import { takeUrlToken } from '../take-url-token';

/**
 * Resending needs the session (the API sends the link to the signed-in account). Without one, the
 * user signs in first and lands on "check your email" with the same button.
 */
function useResendVerification() {
  const api = useApiClient();
  const router = useRouter();
  const [resendStatus, setResendStatus] = useState<ResendStatus>('idle');
  const [resendErrors, setResendErrors] = useState<FormErrors>({});

  async function resend() {
    setResendStatus('pending');
    setResendErrors({});
    const result = await api.resendVerification();
    if (result.ok) {
      setResendStatus('sent');
      return;
    }
    if (result.code === 'UNAUTHENTICATED') {
      router.push('/sign-in');
      return;
    }
    setResendStatus('idle');
    setResendErrors(toFormErrors(result));
  }

  return {
    resendStatus,
    resendErrors,
    onResend: () => {
      void resend();
    },
  };
}

/** `verify-email?token=...`: posts the token from the link as soon as the page opens. */
export function VerifyEmailContainer() {
  const api = useApiClient();
  const started = useRef(false);
  const [status, setStatus] = useState<VerificationStatus>('verifying');
  const [errors, setErrors] = useState<FormErrors>({});
  const { resendStatus, resendErrors, onResend } = useResendVerification();

  useEffect(() => {
    // Runs again on React's development remount: a second POST would find the token used.
    if (started.current) return;
    started.current = true;

    const parsed = verifyEmailRequestSchema.safeParse({ token: takeUrlToken() });
    if (!parsed.success) {
      setStatus('failed');
      setErrors({ form: 'tokenInvalid' });
      return;
    }
    void api.verifyEmail(parsed.data).then((result) => {
      if (result.ok) {
        setStatus('verified');
        return;
      }
      setStatus('failed');
      setErrors(toFormErrors(result));
    });
  }, [api]);

  return (
    <VerifyEmailStatus
      status={status}
      resendStatus={resendStatus}
      errors={resendErrors.form ? resendErrors : errors}
      onResend={onResend}
    />
  );
}

/** "Check your email", with a resend button (AC-04). */
export function CheckYourEmailContainer() {
  const { resendStatus, resendErrors, onResend } = useResendVerification();
  return (
    <VerifyEmailNotice resendStatus={resendStatus} errors={resendErrors} onResend={onResend} />
  );
}
