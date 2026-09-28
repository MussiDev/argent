import type { ReactNode } from 'react';

/** Public authentication screens: one centered card, mobile first. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center p-4">
      {children}
    </main>
  );
}
