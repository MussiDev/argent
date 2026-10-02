'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

/** What was saved: the rate frozen on the movement (already formatted) and the way back to the list. */
export function MovementSaved({ rate }: { rate: string }) {
  const t = useTranslations('movements.saved');

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p role="status" className="text-sm text-muted-foreground">
          {t('rate', { rate })}
        </p>
        <Link href="/movements" className="text-sm text-primary underline-offset-4 hover:underline">
          {t('back')}
        </Link>
      </CardContent>
    </Card>
  );
}
