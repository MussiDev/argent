import { z } from 'zod';

/** Signed 64-bit range of a `bigint` PostgreSQL column; amounts are minor units (centavos). */
export const MINOR_UNITS_MAX = 9223372036854775807n;
export const MINOR_UNITS_MIN = -9223372036854775808n;

const MINOR_UNITS_PATTERN = /^-?(0|[1-9]\d*)$/;

function inRange(value: bigint): boolean {
  return value >= MINOR_UNITS_MIN && value <= MINOR_UNITS_MAX;
}

/** A decimal integer string inside the int64 range: how amounts travel in JSON. */
export const minorUnitsStringSchema = z
  .string()
  .refine((text) => MINOR_UNITS_PATTERN.test(text) && inRange(BigInt(text)), {
    message: 'Amount must be an integer string within the signed 64-bit range',
  });

export function parseMinorUnits(text: string): bigint {
  return BigInt(minorUnitsStringSchema.parse(text));
}

export function formatMinorUnitsString(value: bigint): string {
  return value.toString();
}

export function addMinorUnits(a: bigint, b: bigint): bigint {
  const result = a + b;
  if (!inRange(result)) {
    throw new RangeError('Amount is outside the signed 64-bit range');
  }
  return result;
}

export function sumMinorUnits(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const value of values) {
    total = addMinorUnits(total, value);
  }
  return total;
}

/** Formats minor units for display. The exact decimal string goes to Intl: no float is created. */
export function formatMoney(value: bigint, currency: string, locale: string): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const cents = (abs % 100n).toString().padStart(2, '0');
  const decimal = `${negative ? '-' : ''}${(abs / 100n).toString()}.${cents}`;
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    decimal as `${number}`,
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reads a user-typed amount in the locale's own notation (group and decimal separators come from
 * Intl). Returns minor units, or `null` for anything malformed, with more than two decimals, or
 * outside the int64 range.
 */
export function parseAmountInput(text: string, locale: string): bigint | null {
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.8);
  const group = parts.find((p) => p.type === 'group')?.value ?? ',';
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
  const g = escapeRegExp(group);
  const d = escapeRegExp(decimal);
  const pattern = new RegExp(`^(-)?(\\d+|\\d{1,3}(?:${g}\\d{3})+)(?:${d}(\\d{1,2}))?$`);
  const match = pattern.exec(text.trim());
  if (match === null) return null;
  const [, sign, intPart = '', fraction = ''] = match;
  const digits = intPart.split(group).join('');
  const magnitude = BigInt(digits) * 100n + BigInt(fraction.padEnd(2, '0'));
  const value = sign === '-' ? -magnitude : magnitude;
  return inRange(value) ? value : null;
}
