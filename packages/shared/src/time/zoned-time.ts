import { isIanaTimeZone } from '../profile/time-zone';

const FALLBACK_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DAY_MS = 24 * 60 * 60_000;

const validZones = new Map<string, boolean>();

function safeZone(timeZone: string): string {
  let valid = validZones.get(timeZone);
  if (valid === undefined) {
    valid = isIanaTimeZone(timeZone);
    validZones.set(timeZone, valid);
  }
  return valid ? timeZone : FALLBACK_TIME_ZONE;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function partsOf(instant: Date, timeZone: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of formatterFor(safeZone(timeZone)).formatToParts(instant)) {
    result[part.type] = part.value;
  }
  return result;
}

/** `YYYY-MM-DD` of an instant in the given zone (unknown zone: Buenos Aires). */
export function dateInTimeZone(instant: Date, timeZone: string): string {
  const p = partsOf(instant, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function todayInTimeZone(now: Date, timeZone: string): string {
  return dateInTimeZone(now, timeZone);
}

/** `YYYY-MM-DDTHH:mm` wall-clock time of an instant in the zone, the `datetime-local` format. */
export function instantToZonedLocal(instant: Date, timeZone: string): string {
  const p = partsOf(instant, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * The UTC instant of a local `YYYY-MM-DDTHH:mm` in the zone. A repeated local time (clocks going
 * back) gives the earlier instant; a skipped one (clocks going forward) and malformed text give
 * `null`. Candidates come from the zone's offsets one day either side of the local time read as UTC.
 */
export function zonedLocalToInstant(localDateTime: string, timeZone: string): Date | null {
  const match = LOCAL_PATTERN.exec(localDateTime);
  if (match === null) return null;
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0] = match
    .slice(1)
    .map((n) => Number.parseInt(n, 10));
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(guess)) return null;
  const zone = safeZone(timeZone);
  const offsets = new Set<number>();
  for (const probe of [guess - DAY_MS, guess, guess + DAY_MS]) {
    const local = instantToZonedLocal(new Date(probe), zone);
    offsets.add(Date.parse(`${local}:00Z`) - probe);
  }
  const matches: number[] = [];
  for (const offset of offsets) {
    const candidate = guess - offset;
    if (instantToZonedLocal(new Date(candidate), zone) === localDateTime) {
      matches.push(candidate);
    }
  }
  if (matches.length === 0) return null;
  return new Date(Math.min(...matches));
}
