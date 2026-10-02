import { useTranslations } from 'next-intl';
import { AccountsContainer } from '@/features/accounts/containers/accounts-container';

export default function AccountsPage() {
  const t = useTranslations('accounts');

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <AccountsContainer />
    </main>
  );
}
