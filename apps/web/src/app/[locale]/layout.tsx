import type { Metadata } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { ApiClientProvider } from '@/lib/api-client-provider';
import { parseWebEnv } from '@/lib/web-env';
import '../globals.css';

// Pages render per request so the CSP nonce from `proxy.ts` can be applied to Next.js' scripts.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: LayoutProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'metadata' });
  return { title: t('title'), description: t('description') };
}

export default async function LocaleLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  // Only the API's origin reaches the browser; every API call is made client-side from there.
  const apiOrigin = parseWebEnv(process.env).API_ORIGIN ?? '';

  return (
    <html lang={locale}>
      <body className="bg-background text-foreground min-h-dvh antialiased">
        <NextIntlClientProvider>
          <ApiClientProvider apiOrigin={apiOrigin}>{children}</ApiClientProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
