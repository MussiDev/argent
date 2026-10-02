import { QUANTITY_SCALE, formatMinorUnits, formatScaledDecimal } from '@pesly/shared';
import type { Locale } from '@/i18n/routing';

const SEPARATORS = {
  en: { group: ',', decimal: '.' },
  es: { group: '.', decimal: ',' },
} as const;

const DATE_LOCALE: Record<Locale, string> = { en: 'en-US', es: 'es-AR' };

/** Minor units (2 decimals) with the language's separators, e.g. 185,000.00 or 185.000,00. */
export function formatAmount(minorUnits: bigint, language: Locale): string {
  return formatMinorUnits(minorUnits, language);
}

/** A quantity scaled by 10^8; trailing zeros are dropped, grouping uses string operations. */
export function formatQuantity(scaled: bigint, language: Locale): string {
  const { group, decimal } = SEPARATORS[language];
  const text = formatScaledDecimal(scaled, QUANTITY_SCALE);
  const negative = text.startsWith('-');
  const [whole = '', fraction] = (negative ? text.slice(1) : text).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+$)/g, group);
  const body = fraction === undefined ? grouped : `${grouped}${decimal}${fraction}`;
  return negative ? `-${body}` : body;
}

/** Signed basis points as a percentage with 2 decimals, e.g. 2333 -> 23.33%. */
export function formatPercentage(basisPoints: bigint, language: Locale): string {
  const { decimal } = SEPARATORS[language];
  const negative = basisPoints < 0n;
  const digits = (negative ? -basisPoints : basisPoints).toString().padStart(3, '0');
  const whole = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  return `${negative ? '-' : ''}${whole}${decimal}${fraction}%`;
}

/** An ISO instant shown in the user's time zone (the day boundary depends on it). */
export function formatDateTime(iso: string, timeZone: string, language: Locale): string {
  return new Intl.DateTimeFormat(DATE_LOCALE[language], {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}
