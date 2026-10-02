import { MAX_TEXT_LENGTH, QUANTITY_SCALE, parseScaledDecimal } from '@pesly/shared';
import type { Locale } from '@/i18n/routing';

export type DecimalInputError =
  'empty' | 'notANumber' | 'tooManyDecimals' | 'notPositive' | 'ambiguousSeparator';

export type DecimalInputResult =
  { ok: true; value: string } | { ok: false; error: DecimalInputError };

const AMOUNT_SCALE = 100n;
const NEGATIVE_NUMBER = /^-\s*[0-9]*[.,]?[0-9]+$/;
// At most one separator in total; several separators (thousands grouping) are not accepted.
const TYPED_DECIMAL = /^[0-9]*[.,]?[0-9]*$/;
const DECIMAL_SEPARATOR: Record<Locale, string> = { es: ',', en: '.' };

/**
 * A lone separator that is not the language's own is read as a decimal point, except when it is
 * followed by exactly three digits after a non-zero whole part: "1.000" in Spanish or "1,000" in
 * English most likely means one thousand, and guessing wrong would be a silent 1000x error. With a
 * zero whole part ("0.001", ".5") there is no thousands reading, so it stays a decimal.
 */
function isAmbiguous(typed: string, language: Locale): boolean {
  const separator = typed.includes(',') ? ',' : typed.includes('.') ? '.' : null;
  if (separator === null || separator === DECIMAL_SEPARATOR[language]) return false;
  const [whole = '', fraction = ''] = typed.split(separator);
  return fraction.length === 3 && /[1-9]/.test(whole);
}

function parseScaled(text: string, scale: bigint, language: Locale): DecimalInputResult {
  const typed = text.trim();
  if (typed === '') return { ok: false, error: 'empty' };
  if (typed.length > MAX_TEXT_LENGTH) return { ok: false, error: 'notANumber' };
  if (NEGATIVE_NUMBER.test(typed)) return { ok: false, error: 'notPositive' };
  if (!TYPED_DECIMAL.test(typed) || !/[0-9]/.test(typed)) return { ok: false, error: 'notANumber' };
  if (isAmbiguous(typed, language)) return { ok: false, error: 'ambiguousSeparator' };

  // ".5" and "5." are valid typing; the shared parser wants digits on both sides of the dot.
  const [whole = '', fraction] = typed.replace(',', '.').split('.');
  const normalized = fraction === undefined ? whole : `${whole || '0'}.${fraction || '0'}`;
  // Padding ".5" to "0.5" can push the text past the limit the shared parser enforces.
  if (normalized.length > MAX_TEXT_LENGTH) return { ok: false, error: 'notANumber' };
  const scaled = parseScaledDecimal(normalized, scale);
  if (scaled === null) return { ok: false, error: 'tooManyDecimals' };
  if (scaled <= 0n) return { ok: false, error: 'notPositive' };
  return { ok: true, value: scaled.toString() };
}

/** Money typed by the user to minor units (scale 100, at most 2 decimals), always above zero. */
export function parseAmountInput(text: string, language: Locale): DecimalInputResult {
  return parseScaled(text, AMOUNT_SCALE, language);
}

/** A quantity typed by the user to scale 10^8 (at most 8 decimals), always above zero. */
export function parseQuantityInput(text: string, language: Locale): DecimalInputResult {
  return parseScaled(text, QUANTITY_SCALE, language);
}
