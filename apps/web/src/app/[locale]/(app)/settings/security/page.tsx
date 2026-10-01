import { useTranslations } from 'next-intl';
import { SecuritySettingsContainer } from '@/features/two-factor/containers/security-settings-container';

export default function SecuritySettingsPage() {
  const t = useTranslations('security');

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <SecuritySettingsContainer />
    </main>
  );
}
