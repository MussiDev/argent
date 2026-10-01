import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export default function HomePage() {
  const t = useTranslations('home');
  const tAccounts = useTranslations('accounts');

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-2 p-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-muted-foreground">{t('tagline')}</p>
      <Link href="/accounts" className={buttonVariants({ className: 'mt-4 w-fit' })}>
        {tAccounts('link')}
      </Link>
    </main>
  );
}
