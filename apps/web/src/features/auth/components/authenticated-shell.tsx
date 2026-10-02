'use client';

import { useTranslations } from 'next-intl';
import { House, ShieldCheck, Tags, UserRound, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import type { ErrorMessageKey } from '../form-errors';
import { FormAlert } from './form-alert';
import { SignOutButton } from './sign-out-button';

export type ShellState =
  { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; error: ErrorMessageKey };

export interface AuthenticatedShellProps {
  state: ShellState;
  /** The current path without the locale, e.g. `/settings/security`; marks its nav link. */
  currentPath?: string;
  signingOut: boolean;
  signOutError: ErrorMessageKey | undefined;
  onRetry: () => void;
  onSignOut: () => void;
  children: ReactNode;
}

/** The frame of the authenticated area: session check progress, its failure, or the app. */
export function AuthenticatedShell({
  state,
  currentPath,
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
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <nav className="flex flex-1 items-center gap-1">
          <Link
            href="/"
            aria-current={currentPath === '/' ? 'page' : undefined}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <House aria-hidden />
            {t('nav.home')}
          </Link>
          <Link
            href="/categories"
            aria-current={currentPath === '/categories' ? 'page' : undefined}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <Tags aria-hidden />
            {t('nav.categories')}
          </Link>
          <Link
            href="/investments"
            aria-current={currentPath === '/investments' ? 'page' : undefined}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <Wallet aria-hidden />
            {t('nav.investments')}
          </Link>
          <Link
            href="/settings/security"
            aria-current={currentPath === '/settings/security' ? 'page' : undefined}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <ShieldCheck aria-hidden />
            {t('nav.security')}
          </Link>
          <Link
            href="/settings/profile"
            aria-current={currentPath === '/settings/profile' ? 'page' : undefined}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <UserRound aria-hidden />
            {t('nav.profile')}
          </Link>
        </nav>
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
