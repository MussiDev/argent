import { describe, expect, it } from 'vitest';
import { dateInTimeZone, instantToZonedLocal, todayInTimeZone, zonedLocalToInstant } from '../src';

const BA = 'America/Argentina/Buenos_Aires';

describe('todayInTimeZone and dateInTimeZone', () => {
  it('returns the local calendar day around midnight in Buenos Aires (AC-15)', () => {
    expect(todayInTimeZone(new Date('2026-03-02T02:59:59Z'), BA)).toBe('2026-03-01');
    expect(todayInTimeZone(new Date('2026-03-02T03:00:00Z'), BA)).toBe('2026-03-02');
    expect(dateInTimeZone(new Date('2026-03-02T02:59:59Z'), BA)).toBe('2026-03-01');
  });

  it('returns the local calendar day for a zone ahead of UTC (AC-15)', () => {
    const zone = 'Pacific/Auckland';
    expect(dateInTimeZone(new Date('2026-06-30T11:59:59Z'), zone)).toBe('2026-06-30');
    expect(dateInTimeZone(new Date('2026-06-30T12:00:00Z'), zone)).toBe('2026-07-01');
  });

  it('falls back to Buenos Aires for an unknown zone instead of throwing (AC-15)', () => {
    const instant = new Date('2026-03-02T02:59:59Z');
    expect(todayInTimeZone(instant, 'Mars/Olympus')).toBe('2026-03-01');
    expect(dateInTimeZone(instant, '')).toBe('2026-03-01');
  });
});

describe('zonedLocalToInstant and instantToZonedLocal', () => {
  it('round-trips a normal local time in Buenos Aires (AC-31)', () => {
    const instant = zonedLocalToInstant('2026-03-01T23:30', BA);
    expect(instant?.toISOString()).toBe('2026-03-02T02:30:00.000Z');
    expect(instant && instantToZonedLocal(instant, BA)).toBe('2026-03-01T23:30');
  });

  it('formats midnight as 00:00 and never 24:00', () => {
    expect(instantToZonedLocal(new Date('2026-03-02T03:00:00Z'), BA)).toBe('2026-03-02T00:00');
  });

  it('takes the earlier instant for a repeated local time (AC-31)', () => {
    // Madrid went back from 03:00 CEST to 02:00 CET on 2024-10-27: 02:30 happened twice.
    const instant = zonedLocalToInstant('2024-10-27T02:30', 'Europe/Madrid');
    expect(instant?.toISOString()).toBe('2024-10-27T00:30:00.000Z');
    const newYork = zonedLocalToInstant('2024-11-03T01:30', 'America/New_York');
    expect(newYork?.toISOString()).toBe('2024-11-03T05:30:00.000Z');
  });

  it('returns null for a skipped local time (AC-31)', () => {
    expect(zonedLocalToInstant('2024-03-31T02:30', 'Europe/Madrid')).toBeNull();
    expect(zonedLocalToInstant('2024-03-10T02:30', 'America/New_York')).toBeNull();
  });

  it('resolves times next to the transitions', () => {
    expect(zonedLocalToInstant('2024-03-31T03:00', 'Europe/Madrid')?.toISOString()).toBe(
      '2024-03-31T01:00:00.000Z',
    );
    expect(zonedLocalToInstant('2024-10-27T03:00', 'Europe/Madrid')?.toISOString()).toBe(
      '2024-10-27T02:00:00.000Z',
    );
  });

  it('uses the fallback zone for an unknown zone and null for malformed text', () => {
    expect(zonedLocalToInstant('2026-03-01T23:30', 'Mars/Olympus')?.toISOString()).toBe(
      '2026-03-02T02:30:00.000Z',
    );
    for (const text of [
      '',
      '2026-03-01',
      '2026-03-01 23:30',
      '2026-02-30T10:00',
      '2026-03-01T24:00',
    ]) {
      expect(zonedLocalToInstant(text, BA), text).toBeNull();
    }
  });
});
