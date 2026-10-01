'use client';

import { CircleCheck, ShieldCheck, ShieldOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormAlert } from '@/features/auth/components/form-alert';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { useFocusHeading } from '../use-focus-heading';

export type TwoFactorStatusState =
  | { kind: 'loading' }
  | { kind: 'failed'; error: ErrorMessageKey }
  | { kind: 'ready'; enabled: boolean; recoveryCodesRemaining: number };

/** What the last enable or disable did, confirmed until the screen changes. */
export type TwoFactorNotice = 'enabled' | 'disabled';

export interface TwoFactorStatusProps {
  /** Focus the heading on mount: set when this view replaced another one. */
  focusHeading?: boolean;
  state: TwoFactorStatusState;
  /** The setup is being started. */
  pending: boolean;
  notice?: TwoFactorNotice;
  error?: ErrorMessageKey;
  onEnable: () => void;
  onDisable: () => void;
  onRetry: () => void;
}

/** Whether 2FA is on, how many recovery codes are left (never the codes), and how to change it. */
export function TwoFactorStatus({
  focusHeading = false,
  state,
  pending,
  notice,
  error,
  onEnable,
  onDisable,
  onRetry,
}: TwoFactorStatusProps) {
  const t = useTranslations('security');
  const tApp = useTranslations('app');
  const headingRef = useFocusHeading(focusHeading);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" ref={headingRef} tabIndex={-1} className="outline-none">
          {t('twoFactor.title')}
        </CardTitle>
        <CardDescription>{t('twoFactor.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {notice ? (
          <Alert role="status">
            <CircleCheck aria-hidden />
            <AlertDescription>
              {t(notice === 'enabled' ? 'enabledNotice' : 'disabledNotice')}
            </AlertDescription>
          </Alert>
        ) : null}
        <FormAlert error={state.kind === 'failed' ? state.error : error} />
        {state.kind === 'loading' ? (
          <p role="status" className="text-sm text-muted-foreground">
            {tApp('loading')}
          </p>
        ) : null}
        {state.kind === 'failed' ? (
          <Button variant="outline" onClick={onRetry}>
            {tApp('retry')}
          </Button>
        ) : null}
        {state.kind === 'ready' ? (
          <>
            <p className="flex items-center gap-2 text-sm font-medium">
              {state.enabled ? (
                <ShieldCheck aria-hidden className="size-4 text-primary" />
              ) : (
                <ShieldOff aria-hidden className="size-4 text-muted-foreground" />
              )}
              <span>{state.enabled ? t('twoFactor.on') : t('twoFactor.off')}</span>
            </p>
            {state.enabled ? (
              <p className="text-sm text-muted-foreground">
                {t('twoFactor.recoveryCodesRemaining', { count: state.recoveryCodesRemaining })}
              </p>
            ) : null}
            {state.enabled ? (
              <Button variant="outline" onClick={onDisable}>
                {t('twoFactor.disable')}
              </Button>
            ) : (
              <Button disabled={pending} onClick={onEnable}>
                {pending ? t('twoFactor.starting') : t('twoFactor.enable')}
              </Button>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
