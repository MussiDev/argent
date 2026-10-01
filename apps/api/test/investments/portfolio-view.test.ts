import { STALE_PRICE_AFTER_MS } from '@argent/shared';
import { describe, expect, it } from 'vitest';
import {
  buildHoldingView,
  buildPortfolioView,
  buildPortfolioViews,
} from '../../src/investments/application/portfolio-view';
import type { Portfolio } from '../../src/investments/application/ports';
import type { Holding } from '../../src/investments/domain/holding';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const PORTFOLIO: Portfolio = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Balanz',
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
};

function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    portfolioId: PORTFOLIO.id,
    ticker: 'AAPL',
    instrumentName: 'Apple CEDEAR',
    instrumentType: 'cedear',
    quantity: 1_000_000_000n,
    valuationCurrency: 'ARS',
    totalCost: 15_000_000n,
    price: { unitPrice: 1_850_000n, source: 'manual', pricedAt: NOW },
    ...overrides,
  };
}

describe('buildHoldingView', () => {
  it('gives a holding with no price a null value and a null gain, not stale (AC-19)', () => {
    const view = buildHoldingView(holding({ price: null }), NOW);

    expect(view.value).toBeNull();
    expect(view.gain).toBeNull();
    expect(view.priceStale).toBe(false);
  });

  it('values a priced holding and computes its gain (AC-12 control)', () => {
    const view = buildHoldingView(holding(), NOW);

    expect(view.value).toBe(18_500_000n);
    expect(view.gain).toEqual({ amount: 3_500_000n, basisPoints: 2333n });
    expect(view.priceStale).toBe(false);
  });

  it('gives a holding without total cost a value but no gain (AC-12)', () => {
    const view = buildHoldingView(holding({ totalCost: null }), NOW);

    expect(view.value).toBe(18_500_000n);
    expect(view.gain).toBeNull();
  });

  it('flags a price older than 7 days as stale and keeps its date (AC-14)', () => {
    const pricedAt = new Date(NOW.getTime() - STALE_PRICE_AFTER_MS - 1);
    const view = buildHoldingView(
      holding({ price: { unitPrice: 1_850_000n, source: 'import', pricedAt } }),
      NOW,
    );

    expect(view.priceStale).toBe(true);
    expect(view.price?.pricedAt).toEqual(pricedAt);
  });

  it('does not flag a price at exactly 7 days (AC-14 boundary)', () => {
    const pricedAt = new Date(NOW.getTime() - STALE_PRICE_AFTER_MS);
    const view = buildHoldingView(
      holding({ price: { unitPrice: 1_850_000n, source: 'import', pricedAt } }),
      NOW,
    );

    expect(view.priceStale).toBe(false);
  });
});

describe('buildPortfolioView', () => {
  it('totals only priced holdings: 185,000.00 ARS plus an unpriced one (AC-20)', () => {
    const view = buildPortfolioView(
      PORTFOLIO,
      [holding(), holding({ id: 'b', ticker: 'MELI', price: null })],
      NOW,
    );

    expect(view.totals).toEqual([{ currency: 'ARS', value: 18_500_000n }]);
    expect(view.holdingsWithoutPrice).toBe(1);
  });

  it('lists ARS before USD and omits a currency with no valued holding', () => {
    const usd = holding({
      id: 'c',
      ticker: 'BTC',
      instrumentType: 'crypto',
      valuationCurrency: 'USD',
      quantity: 100_000_000n,
      price: { unitPrice: 50_000n, source: 'manual', pricedAt: NOW },
    });
    const both = buildPortfolioView(PORTFOLIO, [usd, holding()], NOW);
    const onlyUsd = buildPortfolioView(PORTFOLIO, [usd], NOW);
    const none = buildPortfolioView(PORTFOLIO, [holding({ price: null })], NOW);

    expect(both.totals).toEqual([
      { currency: 'ARS', value: 18_500_000n },
      { currency: 'USD', value: 50_000n },
    ]);
    expect(onlyUsd.totals).toEqual([{ currency: 'USD', value: 50_000n }]);
    expect(none.totals).toEqual([]);
  });

  it('counts holdings without a price (AC-21)', () => {
    const view = buildPortfolioView(
      PORTFOLIO,
      [holding({ id: 'a', price: null }), holding({ id: 'b', ticker: 'MELI', price: null })],
      NOW,
    );

    expect(view.holdingsWithoutPrice).toBe(2);
  });

  it('orders holdings by ticker ignoring case', () => {
    const view = buildPortfolioView(
      PORTFOLIO,
      [
        holding({ id: 'a', ticker: 'CEDE' }),
        holding({ id: 'b', ticker: 'Bbar' }),
        holding({ id: 'c', ticker: 'aapl' }),
      ],
      NOW,
    );

    // A case-sensitive sort would give ['Bbar', 'CEDE', 'aapl'].
    expect(view.holdings.map((h) => h.ticker)).toEqual(['aapl', 'Bbar', 'CEDE']);
  });

  it('has empty holdings and no totals for an empty portfolio', () => {
    const view = buildPortfolioView(PORTFOLIO, [], NOW);

    expect(view).toMatchObject({
      id: PORTFOLIO.id,
      name: 'Balanz',
      createdAt: PORTFOLIO.createdAt,
      totals: [],
      holdingsWithoutPrice: 0,
      holdings: [],
    });
  });
});

describe('buildPortfolioViews', () => {
  it('groups holdings by portfolio and orders portfolios by creation time', () => {
    const older: Portfolio = { id: 'older', name: 'Old', createdAt: new Date('2026-01-01') };
    const newer: Portfolio = { id: 'newer', name: 'New', createdAt: new Date('2026-06-01') };

    const views = buildPortfolioViews(
      [newer, older],
      [holding({ id: 'a', portfolioId: 'older' }), holding({ id: 'b', portfolioId: 'newer' })],
      NOW,
    );

    expect(views.map((v) => v.id)).toEqual(['older', 'newer']);
    expect(views[0]?.holdings.map((h) => h.id)).toEqual(['a']);
    expect(views[1]?.holdings.map((h) => h.id)).toEqual(['b']);
  });

  it('breaks a creation-time tie by id, whatever the input order', () => {
    const createdAt = new Date('2026-03-01T00:00:00.000Z');
    const a: Portfolio = { id: 'a-id', name: 'A', createdAt };
    const b: Portfolio = { id: 'b-id', name: 'B', createdAt };
    const c: Portfolio = { id: 'c-id', name: 'C', createdAt };

    expect(buildPortfolioViews([c, a, b], [], NOW).map((v) => v.id)).toEqual([
      'a-id',
      'b-id',
      'c-id',
    ]);
    expect(buildPortfolioViews([b, c, a], [], NOW).map((v) => v.id)).toEqual([
      'a-id',
      'b-id',
      'c-id',
    ]);
  });
});
