import { QUANTITY_MAX, TOTAL_COST_MAX } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import { InvestmentRuleViolation } from '../../src/investments/domain/errors';
import {
  applyHoldingEdit,
  assertCryptoInUsd,
  mergeHoldings,
  type Holding,
} from '../../src/investments/domain/holding';

const PRICED_AT = new Date('2026-09-30T12:00:00.000Z');

function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    portfolioId: '22222222-2222-4222-8222-222222222222',
    ticker: 'AAPL',
    instrumentName: 'Apple CEDEAR',
    instrumentType: 'cedear',
    quantity: 1_000_000_000n,
    valuationCurrency: 'ARS',
    totalCost: 15_000_000n,
    price: { unitPrice: 1_850_000n, source: 'manual', pricedAt: PRICED_AT },
    ...overrides,
  };
}

function incoming(
  overrides: Partial<Pick<Holding, 'quantity' | 'valuationCurrency' | 'totalCost'>> = {},
): Pick<Holding, 'quantity' | 'valuationCurrency' | 'totalCost'> {
  return { quantity: 500_000_000n, valuationCurrency: 'ARS', totalCost: 5_000_000n, ...overrides };
}

function violationOf(action: () => unknown): InvestmentRuleViolation {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(InvestmentRuleViolation);
    return error as InvestmentRuleViolation;
  }
  throw new Error('expected an InvestmentRuleViolation');
}

describe('mergeHoldings', () => {
  it('sums quantity and cost and keeps the existing price (AC-23)', () => {
    const merged = mergeHoldings(holding(), incoming());

    expect(merged.quantity).toBe(1_500_000_000n);
    expect(merged.totalCost).toBe(20_000_000n);
    expect(merged.price).toEqual({ unitPrice: 1_850_000n, source: 'manual', pricedAt: PRICED_AT });
    expect(merged.ticker).toBe('AAPL');
    expect(merged.instrumentName).toBe('Apple CEDEAR');
    expect(merged.id).toBe(holding().id);
  });

  it('rejects a merge across currencies on valuationCurrency (AC-24)', () => {
    const violation = violationOf(() =>
      mergeHoldings(holding(), incoming({ valuationCurrency: 'USD' })),
    );

    expect(violation.code).toBe('VALIDATION_FAILED');
    expect(violation.fields).toEqual(['body.valuationCurrency']);
    expect(violation.message).toBe('valuationCurrency');
  });

  it('leaves the cost null when either side has no cost (AC-25)', () => {
    expect(mergeHoldings(holding({ totalCost: null }), incoming()).totalCost).toBeNull();
    expect(mergeHoldings(holding(), incoming({ totalCost: null })).totalCost).toBeNull();
  });

  it('rejects a quantity sum above the limit on quantity', () => {
    const violation = violationOf(() =>
      mergeHoldings(holding({ quantity: QUANTITY_MAX }), incoming({ quantity: 1n })),
    );

    expect(violation.fields).toEqual(['body.quantity']);
  });

  it('rejects a total cost sum above the limit on totalCost', () => {
    const violation = violationOf(() =>
      mergeHoldings(holding({ totalCost: TOTAL_COST_MAX }), incoming({ totalCost: 1n })),
    );

    expect(violation.fields).toEqual(['body.totalCost']);
  });

  it('accepts sums exactly at the limits', () => {
    const merged = mergeHoldings(
      holding({ quantity: QUANTITY_MAX - 1n, totalCost: TOTAL_COST_MAX - 1n }),
      incoming({ quantity: 1n, totalCost: 1n }),
    );

    expect(merged.quantity).toBe(QUANTITY_MAX);
    expect(merged.totalCost).toBe(TOTAL_COST_MAX);
  });
});

describe('applyHoldingEdit', () => {
  it('keeps price and cost when only the quantity changes (AC-05)', () => {
    const edited = applyHoldingEdit(holding(), { quantity: 1_500_000_000n });

    expect(edited.quantity).toBe(1_500_000_000n);
    expect(edited.totalCost).toBe(15_000_000n);
    expect(edited.price).toEqual(holding().price);
  });

  it('keeps the price when the patch states the same currency', () => {
    const edited = applyHoldingEdit(holding(), { valuationCurrency: 'ARS', totalCost: 1n });

    expect(edited.price).toEqual(holding().price);
    expect(edited.totalCost).toBe(1n);
  });

  it('clears the price when the currency changes with a stated cost (AC-22)', () => {
    const edited = applyHoldingEdit(holding(), { valuationCurrency: 'USD', totalCost: 120_000n });

    expect(edited.valuationCurrency).toBe('USD');
    expect(edited.totalCost).toBe(120_000n);
    expect(edited.price).toBeNull();
  });

  it('accepts an explicit null cost with a currency change', () => {
    const edited = applyHoldingEdit(holding(), { valuationCurrency: 'USD', totalCost: null });

    expect(edited.totalCost).toBeNull();
    expect(edited.price).toBeNull();
  });

  it('clears the cost with an explicit null', () => {
    expect(applyHoldingEdit(holding(), { totalCost: null }).totalCost).toBeNull();
  });

  it('rejects a currency change without a stated cost on totalCost', () => {
    const violation = violationOf(() => applyHoldingEdit(holding(), { valuationCurrency: 'USD' }));

    expect(violation.fields).toEqual(['body.totalCost']);
  });

  it('rejects editing a crypto holding to ARS on valuationCurrency (AC-18)', () => {
    const crypto = holding({ instrumentType: 'crypto', valuationCurrency: 'USD' });
    const violation = violationOf(() =>
      applyHoldingEdit(crypto, { valuationCurrency: 'ARS', totalCost: null }),
    );

    expect(violation.fields).toEqual(['body.valuationCurrency']);
  });

  it('reports valuationCurrency, not totalCost, for crypto to ARS without a cost (AC-18)', () => {
    const crypto = holding({ instrumentType: 'crypto', valuationCurrency: 'USD' });
    const violation = violationOf(() => applyHoldingEdit(crypto, { valuationCurrency: 'ARS' }));

    expect(violation.fields).toEqual(['body.valuationCurrency']);
  });
});

describe('InvestmentRuleViolation', () => {
  it('names every field in the message and prefixes each with body.', () => {
    const violation = new InvestmentRuleViolation('quantity', 'totalCost');

    expect(violation.code).toBe('VALIDATION_FAILED');
    expect(violation.message).toBe('quantity, totalCost');
    expect(violation.fields).toEqual(['body.quantity', 'body.totalCost']);
  });

  it('requires at least one field at compile time', () => {
    // @ts-expect-error a violation without a field is a type error
    const violation = new InvestmentRuleViolation();

    expect(violation).toBeInstanceOf(InvestmentRuleViolation);
  });
});

describe('assertCryptoInUsd', () => {
  it('rejects crypto in ARS and allows every other combination', () => {
    expect(
      violationOf(() => {
        assertCryptoInUsd('crypto', 'ARS');
      }).fields,
    ).toEqual(['body.valuationCurrency']);
    expect(() => {
      assertCryptoInUsd('crypto', 'USD');
    }).not.toThrow();
    expect(() => {
      assertCryptoInUsd('stock', 'ARS');
    }).not.toThrow();
  });
});
