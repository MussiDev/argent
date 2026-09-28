'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { AuthenticatedShell, type ShellState } from '../components/authenticated-shell';
import type { ErrorMessageKey } from '../form-errors';

/**
 * Guards the authenticated area. The session is checked client-side against the API (no Server
 * Component touches credentials): no session → sign-in; unverified email → "check your email"
 * (AC-04). Any other failure (offline included) offers a retry instead of signing the user out.
 */
export function AuthenticatedShellContainer({ children }: { children: ReactNode }) {
  const api = useApiClient();
  const router = useRouter();
  const [state, setState] = useState<ShellState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<ErrorMessageKey | undefined>();

  useEffect(() => {
    let active = true;
    void api.getSession().then((result) => {
      if (!active) return;
      if (!result.ok) {
        if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
        else setState({ kind: 'failed', error: result.messageKey });
        return;
      }
      if (!result.data.user.emailVerified) router.replace('/check-your-email');
      else setState({ kind: 'ready' });
    });
    return () => {
      active = false;
    };
  }, [api, router, attempt]);

  async function signOut() {
    setSigningOut(true);
    setSignOutError(undefined);
    const result = await api.signOut();
    if (result.ok) {
      router.replace('/sign-in');
      return;
    }
    setSigningOut(false);
    setSignOutError(result.messageKey);
  }

  return (
    <AuthenticatedShell
      state={state}
      signingOut={signingOut}
      signOutError={signOutError}
      onRetry={() => {
        setState({ kind: 'loading' });
        setAttempt((value) => value + 1);
      }}
      onSignOut={() => {
        void signOut();
      }}
    >
      {children}
    </AuthenticatedShell>
  );
}
