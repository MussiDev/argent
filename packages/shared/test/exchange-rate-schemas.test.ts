import { describe, expect, it } from 'vitest';
import { RATE_TYPES } from '../src/rate-types';
import {
  exchangeRateSchema,
  latestRatesQuerySchema,
  latestRatesResponseSchema,
  scaledRateStringSchema,
} from '../src/exchange-rates/exchange-rate';

const entry = (rateType: string, buy = '16233000', sell = '16333000') => ({
  rateType,
  buy,
  sell,
  providerUpdatedAt: '2026-10-02T12:00:00.000Z',
  fetchedAt: '2026-10-02T12:01:00.000Z',
});

describe('latestRatesResponseSchema', () => {
  it('accepts a 7-entry body (AC-03)', () => {
    const body = { rates: RATE_TYPES.map((type) => entry(type)) };
    expect(latestRatesResponseSchema.parse(body).rates).toHaveLength(7);
  });

  it('accepts an empty rates array (AC-05)', () => {
    expect(latestRatesResponseSchema.parse({ rates: [] })).toEqual({ rates: [] });
  });

  it('rejects a zero rate, a non-integer string and an unknown rate type', () => {
    expect(latestRatesResponseSchema.safeParse({ rates: [entry('blue', '0')] }).success).toBe(
      false,
    );
    expect(latestRatesResponseSchema.safeParse({ rates: [entry('blue', '1623.3')] }).success).toBe(
      false,
    );
    expect(latestRatesResponseSchema.safeParse({ rates: [entry('euro')] }).success).toBe(false);
  });

  it('rejects bad timestamps', () => {
    expect(exchangeRateSchema.safeParse({ ...entry('blue'), fetchedAt: 'yesterday' }).success).toBe(
      false,
    );
  });
});

describe('scaledRateStringSchema', () => {
  it('accepts 1..max and rejects negative, leading zero, oversized and 13 digits', () => {
    expect(scaledRateStringSchema.safeParse('1').success).toBe(true);
    expect(scaledRateStringSchema.safeParse('100000000000').success).toBe(true);
    for (const text of ['0', '-5', '01', '100000000001', '1000000000000', '', '1e3']) {
      expect(scaledRateStringSchema.safeParse(text).success).toBe(false);
    }
  });
});

describe('latestRatesQuerySchema', () => {
  it('strips unexpected keys', () => {
    expect(latestRatesQuerySchema.parse({ foo: 'bar' })).toEqual({});
  });
});
