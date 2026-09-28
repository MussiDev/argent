import type { MetadataRoute } from 'next';
import messages from '../../messages/es.json';
import { routing } from '@/i18n/routing';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: messages.metadata.title,
    short_name: messages.metadata.title,
    description: messages.metadata.description,
    lang: routing.defaultLocale,
    start_url: `/${routing.defaultLocale}`,
    scope: '/',
    display: 'standalone',
  };
}
