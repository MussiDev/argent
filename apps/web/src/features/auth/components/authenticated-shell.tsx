'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { ErrorMessageKey } from '../form-errors';
import { FormAlert } from './form-alert';
import { SignOutButton } from './sign-out-button';

export type ShellState =
  { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; error: ErrorMessageKey };

export interface AuthenticatedShellProps {
  state: ShellState;
  signingOut: boolean;
  signOutError: ErrorMessageKey | undefined;
  onRetry: () => void;
  onSignOut: () => void;
  children: ReactNode;
}

/** The frame of the authenticated area: session check progress, its failure, or the app. */
export function AuthenticatedShell({
  state,
  signingOut,
  signOutError,
  onRetry,
  onSignOut,
  children,
}: AuthenticatedShellProps) {
  const t = useTranslations('app');

  if (state.kind === 'loading') {
    return (
      <p role="status" className="p-6 text-center text-muted-foreground">
        {t('loading')}
      </p>
    );
  }

  if (state.kind === 'failed') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-4">
        <FormAlert error={state.error} />
        <Button variant="outline" onClick={onRetry}>
          {t('retry')}
        </Button>
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-end gap-2 border-b px-4 py-2">
        <SignOutButton pending={signingOut} onSignOut={onSignOut} />
      </header>
      {signOutError ? (
        <div className="px-4 pt-4">
          <FormAlert error={signOutError} />
        </div>
      ) : null}
      {children}
    </div>
  );
}
