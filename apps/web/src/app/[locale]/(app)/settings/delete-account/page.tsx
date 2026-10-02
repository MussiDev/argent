import { useTranslations } from 'next-intl';
import { DeleteUserContainer } from '@/features/profile/containers/delete-user-container';

export default function DeleteAccountPage() {
  const t = useTranslations('deleteUser');

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <DeleteUserContainer />
    </main>
  );
}
