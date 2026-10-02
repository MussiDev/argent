import { useTranslations } from 'next-intl';
import { InvestmentsContainer } from '@/features/investments/containers/investments-container';

export default function InvestmentsPage() {
  const t = useTranslations('investments');

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('description')}</p>
      <InvestmentsContainer />
    </main>
  );
}
