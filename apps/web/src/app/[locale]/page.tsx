import { useTranslations } from 'next-intl';

export default function HomePage() {
  const t = useTranslations('home');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-2 p-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-muted-foreground">{t('tagline')}</p>
    </main>
  );
}
