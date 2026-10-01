'use client';

import { twoFactorDisableRequestSchema, twoFactorEnableRequestSchema } from '@argent/shared';
import { toString as renderQrCode } from 'qrcode';
import { useCallback, useEffect, useState } from 'react';
import {
  toFormErrors,
  toValidationErrors,
  type ErrorMessageKey,
  type FormErrors,
} from '@/features/auth/form-errors';
import { useRouter } from '@/i18n/navigation';
import type { ApiFailure } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { DisableTwoFactor } from '../components/disable-two-factor';
import { RecoveryCodes, type CopyStatus } from '../components/recovery-codes';
import { TwoFactorSetup } from '../components/two-factor-setup';
import {
  TwoFactorStatus,
  type TwoFactorNotice,
  type TwoFactorStatusState,
} from '../components/two-factor-status';

/** Failures after which the setup (or the disable form) is over: back to the status. */
const ENDS_THE_SETUP: ReadonlySet<ApiFailure['code']> = new Set([
  'UNAUTHENTICATED',
  'TWO_FACTOR_ALREADY_ENABLED',
  'TWO_FACTOR_SETUP_REQUIRED',
]);
const ENDS_THE_DISABLE: ReadonlySet<ApiFailure['code']> = new Set([
  'UNAUTHENTICATED',
  'TWO_FACTOR_NOT_ENABLED',
]);

type View =
  | { kind: 'status' }
  | { kind: 'setup'; secret: string; qrDataUrl: string }
  | { kind: 'recoveryCodes'; codes: string[] }
  | { kind: 'disable' };

/** The `otpauth://` URI as an SVG data URL, rendered here so the secret never leaves the browser. */
async function qrDataUrl(otpauthUri: string): Promise<string> {
  const svg = await renderQrCode(otpauthUri, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Security settings: 2FA status, enrollment (QR, secret, one code), the recovery codes shown once,
 * and disabling with a TOTP or recovery code. Enabling and disabling answer with new session
 * cookies, so this browser stays signed in while every other session ends (FR-05). The recovery
 * codes live only in this component's state: leaving the screen drops them for good (AC-02).
 */
export function SecuritySettingsContainer() {
  const api = useApiClient();
  const router = useRouter();
  const [status, setStatus] = useState<TwoFactorStatusState>({ kind: 'loading' });
  const [view, setView] = useState<View>({ kind: 'status' });
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [statusError, setStatusError] = useState<ErrorMessageKey | undefined>();
  const [notice, setNotice] = useState<TwoFactorNotice | undefined>();
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const [attempt, setAttempt] = useState(0);
  // Focus follows the view only once the user has moved between views, not on the first load.
  const [viewChanged, setViewChanged] = useState(false);

  function show(next: View) {
    setView(next);
    setViewChanged(true);
  }

  const reload = useCallback(() => {
    setStatus({ kind: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    void api.getTwoFactorStatus().then((result) => {
      if (!active) return;
      if (result.ok) setStatus({ kind: 'ready', ...result.data });
      else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else setStatus({ kind: 'failed', error: result.messageKey });
    });
    return () => {
      active = false;
    };
  }, [api, router, attempt]);

  /** Back to the status with a message; a 409 means another session changed 2FA meanwhile. */
  function backToStatus(failure: ApiFailure) {
    if (failure.code === 'UNAUTHENTICATED') {
      router.replace('/sign-in');
      return;
    }
    show({ kind: 'status' });
    setErrors({});
    setStatusError(failure.messageKey);
    if (
      failure.code === 'TWO_FACTOR_ALREADY_ENABLED' ||
      failure.code === 'TWO_FACTOR_NOT_ENABLED'
    ) {
      reload();
    }
  }

  async function startSetup() {
    setPending(true);
    setStatusError(undefined);
    setNotice(undefined);
    const result = await api.startTwoFactorSetup();
    if (!result.ok) {
      setPending(false);
      backToStatus(result);
      return;
    }
    let qr: string;
    try {
      qr = await qrDataUrl(result.data.otpauthUri);
    } catch {
      // Without the QR code the setup cannot be shown; the user may try again.
      setPending(false);
      setStatusError('unexpected');
      return;
    }
    setPending(false);
    setErrors({});
    show({ kind: 'setup', secret: result.data.secret, qrDataUrl: qr });
  }

  async function enable(code: string) {
    const parsed = twoFactorEnableRequestSchema.safeParse({ code });
    if (!parsed.success) {
      setErrors(toValidationErrors(parsed.error, 'totpCodeFormat'));
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.enableTwoFactor(parsed.data);
    setPending(false);
    if (result.ok) {
      setCopyStatus('idle');
      show({ kind: 'recoveryCodes', codes: result.data.recoveryCodes });
    } else if (ENDS_THE_SETUP.has(result.code)) {
      backToStatus(result);
    } else {
      // Wrong code, rate limit, or an unknown outcome (offline, server error): the setup stays,
      // so the secret already in the authenticator app is not lost.
      setErrors(toFormErrors(result));
    }
  }

  async function disable(code: string) {
    const parsed = twoFactorDisableRequestSchema.safeParse({ code });
    if (!parsed.success) {
      setErrors(toValidationErrors(parsed.error, 'secondFactorCodeFormat'));
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.disableTwoFactor(parsed.data);
    setPending(false);
    if (result.ok) {
      setStatus({ kind: 'ready', enabled: false, recoveryCodesRemaining: 0 });
      setNotice('disabled');
      show({ kind: 'status' });
    } else if (ENDS_THE_DISABLE.has(result.code)) {
      backToStatus(result);
    } else {
      setErrors(toFormErrors(result));
    }
  }

  /**
   * Back to the status, read again: an enable or disable whose answer was lost (offline) may have
   * committed, so the status shown before is no longer trusted.
   */
  function leaveForm() {
    setErrors({});
    show({ kind: 'status' });
    reload();
  }

  async function copy(codes: readonly string[]) {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopyStatus('copied');
    } catch {
      // Clipboard access can be denied; the screen says so and offers the download instead.
      setCopyStatus('failed');
    }
  }

  if (view.kind === 'setup') {
    return (
      <TwoFactorSetup
        focusHeading={viewChanged}
        qrDataUrl={view.qrDataUrl}
        secret={view.secret}
        pending={pending}
        errors={errors}
        onSubmit={(code) => {
          void enable(code);
        }}
        onCancel={leaveForm}
      />
    );
  }

  if (view.kind === 'recoveryCodes') {
    const { codes } = view;
    return (
      <RecoveryCodes
        focusHeading={viewChanged}
        codes={codes}
        copyStatus={copyStatus}
        onCopy={() => {
          void copy(codes);
        }}
        onDone={() => {
          setStatus({ kind: 'ready', enabled: true, recoveryCodesRemaining: codes.length });
          setNotice('enabled');
          show({ kind: 'status' });
        }}
      />
    );
  }

  if (view.kind === 'disable') {
    return (
      <DisableTwoFactor
        focusHeading={viewChanged}
        pending={pending}
        errors={errors}
        onSubmit={(code) => {
          void disable(code);
        }}
        onCancel={leaveForm}
      />
    );
  }

  return (
    <TwoFactorStatus
      focusHeading={viewChanged}
      state={status}
      pending={pending}
      notice={notice}
      error={statusError}
      onEnable={() => {
        void startSetup();
      }}
      onDisable={() => {
        setStatusError(undefined);
        setNotice(undefined);
        setErrors({});
        show({ kind: 'disable' });
      }}
      onRetry={reload}
    />
  );
}
