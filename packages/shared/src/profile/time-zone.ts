import { z } from 'zod';

export const TIME_ZONE_MAX_LENGTH = 64;

// Excludes numeric offsets such as `+01:00`, which `Intl` accepts but the IANA database does not list.
const IANA_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

function formatterFor(value: string): Intl.DateTimeFormat | null {
  if (value.length === 0 || value.length > TIME_ZONE_MAX_LENGTH || !IANA_SHAPE.test(value)) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value });
  } catch {
    // RangeError: not a time zone the runtime's IANA database knows.
    return null;
  }
}

export function isIanaTimeZone(value: string): boolean {
  return formatterFor(value) !== null;
}

/** The runtime's spelling of a valid zone (`europe/madrid` becomes `Europe/Madrid`). */
export function canonicalTimeZone(value: string): string {
  const formatter = formatterFor(value);
  if (!formatter) throw new RangeError(`Invalid IANA time zone: ${value}`);
  return formatter.resolvedOptions().timeZone;
}

export const ianaTimeZoneSchema = z
  .string()
  .max(TIME_ZONE_MAX_LENGTH)
  .refine(isIanaTimeZone, { message: 'must be an IANA time zone' })
  .transform(canonicalTimeZone);
