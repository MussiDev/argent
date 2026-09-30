import { useLocale } from 'next-intl';
import { useSyncExternalStore } from 'react';
import { useApiOrigin } from '@/lib/api-client-provider';
import { readDeviceContext, type DeviceContext } from '@/lib/device-context';

const GOOGLE_START_PATH = '/auth/google/start';

/**
 * `GET /auth/google/start` on the API, reached by top-level navigation. A new account starts in the
 * device's time zone and in the language of the screen the user is on.
 */
export function buildGoogleStartUrl(
  apiOrigin: string,
  locale: string,
  device: DeviceContext,
): string {
  const query = new URLSearchParams();
  if (device.timeZone !== undefined) query.set('timeZone', device.timeZone);
  query.set('language', locale);
  return `${apiOrigin.replace(/\/+$/, '')}${GOOGLE_START_PATH}?${query.toString()}`;
}

const NO_DEVICE: DeviceContext = { timeZone: undefined, language: undefined };

function subscribeToNothing(): () => void {
  return () => undefined;
}

/**
 * The start URL for the current screen. The server does not know the device's time zone, so it
 * renders the link without one and the browser fills it in after hydration, without a mismatch.
 */
export function useGoogleStartUrl(): string {
  const apiOrigin = useApiOrigin();
  const locale = useLocale();
  return useSyncExternalStore(
    subscribeToNothing,
    () => buildGoogleStartUrl(apiOrigin, locale, readDeviceContext()),
    () => buildGoogleStartUrl(apiOrigin, locale, NO_DEVICE),
  );
}
