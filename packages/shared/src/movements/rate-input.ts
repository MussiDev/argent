import {
  RATE_SCALE_DECIMALS,
  formatScaledRate,
  parseScaledRate,
} from '../exchange-rates/scaled-rate';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Separators {
  group: string;
  decimal: string;
}

const FALLBACK_SEPARATORS: Separators = { group: ',', decimal: '.' };
const separatorsByLocale = new Map<string, Separators>();

function separators(locale: string): Separators {
  const cached = separatorsByLocale.get(locale);
  if (cached !== undefined) return cached;
  let found = FALLBACK_SEPARATORS;
  try {
    // A decimal string, not a float literal: Intl formats it exactly.
    const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts('1234567.8');
    found = {
      group: parts.find((p) => p.type === 'group')?.value ?? FALLBACK_SEPARATORS.group,
      decimal: parts.find((p) => p.type === 'decimal')?.value ?? FALLBACK_SEPARATORS.decimal,
    };
  } catch {
    // RangeError: a malformed locale tag; the fallback notation is the documented behavior.
  }
  separatorsByLocale.set(locale, found);
  return found;
}

/**
 * Reads a user-typed rate in the locale's notation (up to 4 decimals) into a rate scaled by
 * 10,000, through `parseScaledRate`. Returns `null` for malformed text, more than 4 decimals,
 * zero or above the maximum; never throws.
 */
export function parseRateInput(text: string, locale: string): bigint | null {
  const { group, decimal } = separators(locale);
  const g = escapeRegExp(group);
  const d = escapeRegExp(decimal);
  const pattern = new RegExp(
    `^(\\d+|\\d{1,3}(?:${g}\\d{3})+)(?:${d}(\\d{1,${RATE_SCALE_DECIMALS}}))?$`,
  );
  const match = pattern.exec(text.trim());
  if (match === null) return null;
  const [, whole = '', fraction] = match;
  const digits = whole.split(group).join('');
  // parseScaledRate refuses a leading zero before more digits, which a user may type.
  const canonical = digits.replace(/^0+(?=\d)/, '');
  return parseScaledRate(fraction === undefined ? canonical : `${canonical}.${fraction}`);
}

/** Inverse of `parseRateInput`: no grouping, trailing zeros of the fraction dropped. */
export function formatRateInput(value: bigint, locale: string): string {
  const { decimal } = separators(locale);
  const [whole = '0', fraction = ''] = formatScaledRate(value).split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed === '' ? whole : `${whole}${decimal}${trimmed}`;
}
