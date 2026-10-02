import { describe, expect, it } from 'vitest';
import { RATE_MAX_SCALED, RATE_TYPES } from '@pesly/shared';
import { RateProviderFailure } from '../../src/exchange-rates/domain/errors';
import { assertCompleteQuotes } from '../../src/exchange-rates/domain/rate-quote';
import { sampleQuotes } from './fakes';

function failureOf(run: () => unknown): RateProviderFailure {
  try {
    run();
  } catch (error) {
    if (error instanceof RateProviderFailure) return error;
    throw error;
  }
  throw new Error('expected RateProviderFailure');
}

describe('assertCompleteQuotes', () => {
  it('returns the 7 quotes ordered by RATE_TYPES', () => {
    const shuffled = [...sampleQuotes()].reverse();
    expect(assertCompleteQuotes(shuffled).map((q) => q.rateType)).toEqual([...RATE_TYPES]);
  });

  it('accepts the maximum price', () => {
    const quotes = sampleQuotes().map((q) => ({
      ...q,
      buy: RATE_MAX_SCALED,
      sell: RATE_MAX_SCALED,
    }));
    expect(assertCompleteQuotes(quotes)).toHaveLength(7);
  });

  it('rejects a missing rate type naming it', () => {
    const quotes = sampleQuotes().filter((q) => q.rateType !== 'mep');
    const failure = failureOf(() => assertCompleteQuotes(quotes));
    expect(failure.code).toBe('provider_invalid_payload');
    expect(failure.detail).toContain('mep');
  });

  it('rejects a zero price naming the type', () => {
    const quotes = sampleQuotes().map((q) => (q.rateType === 'blue' ? { ...q, sell: 0n } : q));
    const failure = failureOf(() => assertCompleteQuotes(quotes));
    expect(failure.code).toBe('provider_invalid_payload');
    expect(failure.detail).toContain('blue');
  });

  it('rejects a price above the maximum', () => {
    const quotes = sampleQuotes().map((q) =>
      q.rateType === 'ccl' ? { ...q, buy: RATE_MAX_SCALED + 1n } : q,
    );
    expect(failureOf(() => assertCompleteQuotes(quotes)).detail).toContain('ccl');
  });

  it('rejects a duplicate type naming it', () => {
    const quotes = [...sampleQuotes(), ...sampleQuotes().slice(0, 1)];
    const failure = failureOf(() => assertCompleteQuotes(quotes));
    expect(failure.code).toBe('provider_invalid_payload');
    expect(failure.detail).toContain(RATE_TYPES[0]);
  });
});

describe('RateProviderFailure', () => {
  it('carries the code, status code and detail', () => {
    const failure = new RateProviderFailure('provider_bad_status', {
      statusCode: 500,
      detail: 'x',
    });
    expect(failure).toBeInstanceOf(Error);
    expect(failure.code).toBe('provider_bad_status');
    expect(failure.statusCode).toBe(500);
    expect(failure.detail).toBe('x');
  });
});
