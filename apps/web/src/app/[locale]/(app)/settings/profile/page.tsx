import { useTranslations } from 'next-intl';
import { ProfileContainer } from '@/features/profile/containers/profile-container';

export default function ProfileSettingsPage() {
  const t = useTranslations('profile');

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <ProfileContainer />
    </main>
  );
}
