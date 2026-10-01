const DECIMAL_TEXT = /^[0-9]+(\.[0-9]+)?$/;
const MAX_TEXT_LENGTH = 40;

/** The scale must be 1, 10, 100, ...; anything else would silently misplace the decimal point. */
function decimalPlaces(scale: bigint): number {
  const digits = scale.toString();
  if (scale < 1n || !/^10*$/.test(digits)) {
    throw new RangeError('scale must be a positive power of ten');
  }
  return digits.length - 1;
}

/**
 * Converts decimal text to a scaled integer using string arithmetic only.
 * Returns null for anything that is not digits with one optional dot, has more than
 * log10(scale) decimals or is longer than 40 characters. Throws RangeError when the
 * scale is not a positive power of ten.
 */
export function parseScaledDecimal(text: string, scale: bigint): bigint | null {
  const places = decimalPlaces(scale);
  if (text.length > MAX_TEXT_LENGTH || !DECIMAL_TEXT.test(text)) return null;
  const [whole = '', fraction = ''] = text.split('.');
  if (fraction.length > places) return null;
  return BigInt(whole + fraction.padEnd(places, '0'));
}

/**
 * Inverse of `parseScaledDecimal`: no trailing zeros, no dot for whole numbers.
 * Throws RangeError when the scale is not a positive power of ten.
 */
export function formatScaledDecimal(value: bigint, scale: bigint): string {
  const places = decimalPlaces(scale);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(places + 1, '0');
  const whole = digits.slice(0, digits.length - places);
  const fraction = digits.slice(digits.length - places).replace(/0+$/, '');
  const body = fraction === '' ? whole : `${whole}.${fraction}`;
  return negative ? `-${body}` : body;
}
