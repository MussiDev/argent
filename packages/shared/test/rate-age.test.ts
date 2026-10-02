import { describe, expect, it } from 'vitest';
import { RATE_AGE_BASIS, RATE_AGE_WARNING_MS, rateAgeMs } from '../src';

const now = new Date('2026-10-02T12:00:00.000Z');

describe('rate age', () => {
  it('names fetchedAt as its basis and warns after 2 hours', () => {
    expect(RATE_AGE_BASIS).toBe('fetchedAt');
    expect(RATE_AGE_WARNING_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('measures from the timestamp named by RATE_AGE_BASIS (AC-11)', () => {
    const rate = {
      fetchedAt: '2026-10-02T11:00:00.000Z',
      providerUpdatedAt: '2026-10-02T06:00:00.000Z',
    };
    expect(rateAgeMs(rate, now)).toBe(60 * 60 * 1000);
  });

  it('flags a rate older than the warning threshold (AC-11)', () => {
    const fresh = {
      fetchedAt: '2026-10-02T10:00:00.000Z',
      providerUpdatedAt: '2026-10-01T00:00:00.000Z',
    };
    const stale = {
      fetchedAt: '2026-10-02T09:59:59.000Z',
      providerUpdatedAt: '2026-10-02T11:59:00.000Z',
    };
    expect(rateAgeMs(fresh, now) > RATE_AGE_WARNING_MS).toBe(false);
    expect(rateAgeMs(stale, now) > RATE_AGE_WARNING_MS).toBe(true);
  });
});
