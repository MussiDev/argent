import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AddHolding,
  DeleteHolding,
  GetHolding,
  SetManualPrice,
  UpdateHolding,
  type AddHoldingInput,
} from '../../src/investments/application/holding-use-cases';
import { GetPortfolio } from '../../src/investments/application/portfolio-use-cases';
import { InvestmentRuleViolation } from '../../src/investments/domain/errors';
import { ResourceNotFound } from '../../src/shared/access';
import { MutableClock } from '../fakes/mutable-clock';
import { InMemoryInvestments, scopeFor } from './fakes/in-memory-investments';

const ALICE = randomUUID();
const BOB = randomUUID();
const START = new Date('2026-10-01T12:00:00.000Z');

async function setup() {
  const clock = new MutableClock(START);
  const store = new InMemoryInvestments(clock);
  const portfolio = await store.portfolios.create(await scopeFor(ALICE, 'write'), 'Balanz');
  return {
    clock,
    store,
    portfolio,
    add: new AddHolding(store, clock),
    get: new GetHolding(store.holdings, clock),
    update: new UpdateHolding(store, clock),
    setPrice: new SetManualPrice(store.holdings, clock),
    remove: new DeleteHolding(store.holdings),
    getPortfolio: new GetPortfolio(store.portfolios, store.holdings, clock),
  };
}

function input(portfolioId: string, overrides: Partial<AddHoldingInput> = {}): AddHoldingInput {
  return {
    portfolioId,
    ticker: 'AAPL',
    instrumentName: 'Apple CEDEAR',
    instrumentType: 'cedear',
    quantity: 1_000_000_000n,
    valuationCurrency: 'ARS',
    totalCost: 15_000_000n,
    ...overrides,
  };
}

describe('AddHolding', () => {
  it('stores "AAPL", CEDEAR, 10 units, ARS, cost 150,000.00 without a price (AC-02)', async () => {
    const { add, portfolio, store } = await setup();

    const result = await add.execute(await scopeFor(ALICE, 'write'), input(portfolio.id));

    expect(result.merged).toBe(false);
    expect(result.holding).toMatchObject({
      ticker: 'AAPL',
      instrumentType: 'cedear',
      quantity: 1_000_000_000n,
      valuationCurrency: 'ARS',
      totalCost: 15_000_000n,
      price: null,
      value: null,
      gain: null,
      priceStale: false,
    });
    expect(store.holdingRows.size).toBe(1);
  });

  // The fake only records call order; that the lock really serializes concurrent adds is proven
  // by the Block 4 concurrency test against PostgreSQL.
  it('locks the portfolio before looking up the ticker', async () => {
    const { add, portfolio, store } = await setup();

    await add.execute(await scopeFor(ALICE, 'write'), input(portfolio.id));

    const lock = store.calls.indexOf('portfolios.lockById');
    const lookup = store.calls.indexOf('holdings.findByTicker');
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lookup).toBeGreaterThan(lock);
  });

  it('stores a holding without total cost when none is given', async () => {
    const { add, portfolio } = await setup();

    const { holding } = await add.execute(
      await scopeFor(ALICE, 'write'),
      input(portfolio.id, { totalCost: undefined }),
    );

    expect(holding.totalCost).toBeNull();
  });

  it('merges "aapl" into an existing "AAPL" and reports merged (AC-23)', async () => {
    const { add, portfolio, store } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    const first = await add.execute(scope, input(portfolio.id));

    const second = await add.execute(
      scope,
      input(portfolio.id, { ticker: 'aapl', quantity: 500_000_000n, totalCost: 5_000_000n }),
    );

    expect(second.merged).toBe(true);
    expect(second.holding).toMatchObject({
      id: first.holding.id,
      ticker: 'AAPL',
      quantity: 1_500_000_000n,
      totalCost: 20_000_000n,
    });
    expect(store.holdingRows.size).toBe(1);
  });

  it('raises the domain violation on another currency and leaves the holding unchanged (AC-24)', async () => {
    const { add, portfolio, store } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    await add.execute(scope, input(portfolio.id));

    const attempt = add.execute(scope, input(portfolio.id, { valuationCurrency: 'USD' }));

    await expect(attempt).rejects.toBeInstanceOf(InvestmentRuleViolation);
    await expect(attempt).rejects.toMatchObject({ fields: ['body.valuationCurrency'] });
    const [row] = [...store.holdingRows.values()];
    expect(row?.holding).toMatchObject({ quantity: 1_000_000_000n, valuationCurrency: 'ARS' });
  });

  it('rejects crypto in ARS and stores nothing (AC-18)', async () => {
    const { add, portfolio, store } = await setup();

    const attempt = add.execute(
      await scopeFor(ALICE, 'write'),
      input(portfolio.id, { ticker: 'BTC', instrumentType: 'crypto' }),
    );

    await expect(attempt).rejects.toMatchObject({ fields: ['body.valuationCurrency'] });
    expect(store.holdingRows.size).toBe(0);
  });

  it('answers not found for a portfolio of another user or a missing one (AC-15)', async () => {
    const { add, portfolio, store } = await setup();

    await expect(
      add.execute(await scopeFor(BOB, 'write'), input(portfolio.id)),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(
      add.execute(await scopeFor(ALICE, 'write'), input(randomUUID())),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(store.holdingRows.size).toBe(0);
  });
});

describe('GetHolding', () => {
  it('reads a holding of the caller and hides a foreign one (AC-15)', async () => {
    const { add, get, portfolio } = await setup();
    const { holding } = await add.execute(await scopeFor(ALICE, 'write'), input(portfolio.id));

    const view = await get.execute(await scopeFor(ALICE, 'read'), holding.id);

    expect(view.id).toBe(holding.id);
    await expect(get.execute(await scopeFor(BOB, 'read'), holding.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });
});

describe('UpdateHolding', () => {
  it('keeps the price and cost when only the quantity changes (AC-05)', async () => {
    const { add, update, setPrice, portfolio } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    const { holding } = await add.execute(scope, input(portfolio.id));
    await setPrice.execute(scope, holding.id, 1_850_000n);

    const view = await update.execute(scope, holding.id, { quantity: 1_500_000_000n });

    expect(view).toMatchObject({
      quantity: 1_500_000_000n,
      totalCost: 15_000_000n,
      price: { unitPrice: 1_850_000n, source: 'manual', pricedAt: START },
      value: 27_750_000n,
    });
  });

  // Call order only; real row locking is proven by the Block 4 concurrency test.
  it('reads the holding with a locking read, not a plain one', async () => {
    const { add, update, portfolio, store } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    const { holding } = await add.execute(scope, input(portfolio.id));
    store.calls.length = 0;

    await update.execute(scope, holding.id, { quantity: 1n });

    expect(store.calls).toContain('holdings.findForUpdate');
    expect(store.calls).not.toContain('holdings.findById');
  });

  it('clears the stored price on a currency change so it reads "price needed" (AC-22)', async () => {
    const { add, update, setPrice, portfolio } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    const { holding } = await add.execute(scope, input(portfolio.id));
    await setPrice.execute(scope, holding.id, 1_850_000n);

    const view = await update.execute(scope, holding.id, {
      valuationCurrency: 'USD',
      totalCost: 100_000n,
    });

    expect(view).toMatchObject({
      valuationCurrency: 'USD',
      totalCost: 100_000n,
      price: null,
      value: null,
      gain: null,
    });
  });

  it('raises the violation when a currency change states no cost and changes nothing', async () => {
    const { add, update, store, portfolio } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    const { holding } = await add.execute(scope, input(portfolio.id));

    await expect(
      update.execute(scope, holding.id, { valuationCurrency: 'USD' }),
    ).rejects.toMatchObject({ fields: ['body.totalCost'] });

    expect(store.holdingRows.get(holding.id)?.holding.valuationCurrency).toBe('ARS');
  });

  it('answers not found when updating a holding of another user (AC-15)', async () => {
    const { add, update, store, portfolio } = await setup();
    const { holding } = await add.execute(await scopeFor(ALICE, 'write'), input(portfolio.id));

    await expect(
      update.execute(await scopeFor(BOB, 'write'), holding.id, { quantity: 1n }),
    ).rejects.toBeInstanceOf(ResourceNotFound);

    expect(store.holdingRows.get(holding.id)?.holding.quantity).toBe(1_000_000_000n);
  });

  it('answers not found for a missing holding', async () => {
    const { update } = await setup();

    await expect(
      update.execute(await scopeFor(ALICE, 'write'), randomUUID(), { quantity: 1n }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
  });
});

describe('SetManualPrice', () => {
  it('stores 18,500.00 with source manual and the clock time (AC-07, AC-09)', async () => {
    const { add, setPrice, clock, portfolio } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    const { holding } = await add.execute(scope, input(portfolio.id));
    clock.advance(60_000);

    const view = await setPrice.execute(scope, holding.id, 1_850_000n);

    expect(view.price).toEqual({
      unitPrice: 1_850_000n,
      source: 'manual',
      pricedAt: new Date(START.getTime() + 60_000),
    });
    expect(view.value).toBe(18_500_000n);
    expect(view.gain).toEqual({ amount: 3_500_000n, basisPoints: 2333n });
  });

  it('answers not found for a holding of another user or a missing one (AC-15)', async () => {
    const { add, setPrice, portfolio, store } = await setup();
    const { holding } = await add.execute(await scopeFor(ALICE, 'write'), input(portfolio.id));

    await expect(
      setPrice.execute(await scopeFor(BOB, 'write'), holding.id, 1n),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(
      setPrice.execute(await scopeFor(ALICE, 'write'), randomUUID(), 1n),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(store.holdingRows.get(holding.id)?.holding.price).toBeNull();
  });
});

describe('DeleteHolding', () => {
  it('removes the holding and the portfolio total is recomputed (AC-06)', async () => {
    const { add, setPrice, remove, getPortfolio, portfolio } = await setup();
    const scope = await scopeFor(ALICE, 'write');
    const aapl = await add.execute(scope, input(portfolio.id));
    const meli = await add.execute(scope, input(portfolio.id, { ticker: 'MELI' }));
    await setPrice.execute(scope, aapl.holding.id, 1_850_000n);
    await setPrice.execute(scope, meli.holding.id, 1_000_000n);
    const before = await getPortfolio.execute(await scopeFor(ALICE, 'read'), portfolio.id);
    expect(before.totals).toEqual([{ currency: 'ARS', value: 28_500_000n }]);

    await remove.execute(scope, aapl.holding.id);

    const after = await getPortfolio.execute(await scopeFor(ALICE, 'read'), portfolio.id);
    expect(after.holdings.map((h) => h.ticker)).toEqual(['MELI']);
    expect(after.totals).toEqual([{ currency: 'ARS', value: 10_000_000n }]);
  });

  it('answers not found for a foreign or missing holding (AC-15)', async () => {
    const { add, remove, portfolio, store } = await setup();
    const { holding } = await add.execute(await scopeFor(ALICE, 'write'), input(portfolio.id));

    await expect(remove.execute(await scopeFor(BOB, 'write'), holding.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(
      remove.execute(await scopeFor(ALICE, 'write'), randomUUID()),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(store.holdingRows.size).toBe(1);
  });
});
