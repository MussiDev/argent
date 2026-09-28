import type { ReactNode } from 'react';
import { AuthenticatedShellContainer } from '@/features/auth/containers/authenticated-shell-container';

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AuthenticatedShellContainer>{children}</AuthenticatedShellContainer>;
}
