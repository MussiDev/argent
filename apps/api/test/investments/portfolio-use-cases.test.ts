import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CreatePortfolio,
  DeletePortfolio,
  GetPortfolio,
  ListPortfolios,
} from '../../src/investments/application/portfolio-use-cases';
import { ResourceNotFound } from '../../src/shared/access';
import { MutableClock } from '../fakes/mutable-clock';
import { InMemoryInvestments, scopeFor } from './fakes/in-memory-investments';

const ALICE = randomUUID();
const BOB = randomUUID();

function setup() {
  const clock = new MutableClock(new Date('2026-10-01T12:00:00.000Z'));
  const store = new InMemoryInvestments(clock);
  return {
    clock,
    store,
    create: new CreatePortfolio(store.portfolios, clock),
    list: new ListPortfolios(store.portfolios, store.holdings, clock),
    get: new GetPortfolio(store.portfolios, store.holdings, clock),
    remove: new DeletePortfolio(store.portfolios),
  };
}

async function addHolding(
  store: InMemoryInvestments,
  userId: string,
  portfolioId: string,
  ticker = 'AAPL',
) {
  const inserted = await store.holdings.insert(await scopeFor(userId, 'write'), portfolioId, {
    ticker,
    instrumentName: 'Apple CEDEAR',
    instrumentType: 'cedear',
    quantity: 1_000_000_000n,
    valuationCurrency: 'ARS',
    totalCost: null,
  });
  if (inserted === null) throw new Error('fixture insert failed');
  return inserted;
}

describe('portfolio use cases', () => {
  it('creates a portfolio named "Balanz" that appears in the list (AC-01)', async () => {
    const { create, list } = setup();

    const created = await create.execute(await scopeFor(ALICE, 'write'), 'Balanz');
    const listed = await list.execute(await scopeFor(ALICE, 'read'));

    expect(created).toMatchObject({ name: 'Balanz', holdings: [], totals: [] });
    expect(listed.map((p) => p.id)).toEqual([created.id]);
  });

  it('lists only the caller portfolios (AC-16)', async () => {
    const { create, list } = setup();
    await create.execute(await scopeFor(ALICE, 'write'), 'Alice');
    await create.execute(await scopeFor(BOB, 'write'), 'Bob');

    const listed = await list.execute(await scopeFor(BOB, 'read'));

    expect(listed.map((p) => p.name)).toEqual(['Bob']);
  });

  it('lists portfolios with their holdings and values', async () => {
    const { create, list, store, clock } = setup();
    const created = await create.execute(await scopeFor(ALICE, 'write'), 'Balanz');
    const holding = await addHolding(store, ALICE, created.id);
    await store.holdings.setPrice(
      await scopeFor(ALICE, 'write'),
      holding.id,
      1_850_000n,
      'manual',
      clock.now(),
    );

    const [view] = await list.execute(await scopeFor(ALICE, 'read'));

    expect(view?.totals).toEqual([{ currency: 'ARS', value: 18_500_000n }]);
    expect(view?.holdings).toHaveLength(1);
  });

  it('reads a portfolio of the caller', async () => {
    const { create, get } = setup();
    const created = await create.execute(await scopeFor(ALICE, 'write'), 'Balanz');

    const view = await get.execute(await scopeFor(ALICE, 'read'), created.id);

    expect(view.id).toBe(created.id);
  });

  it('returns only the requested portfolio holdings, totals and unpriced count', async () => {
    const { create, get, store, clock } = setup();
    const write = await scopeFor(ALICE, 'write');
    const first = await create.execute(write, 'First');
    const second = await create.execute(write, 'Second');
    const priced = await addHolding(store, ALICE, first.id, 'AAPL');
    await addHolding(store, ALICE, first.id, 'MELI');
    const otherPriced = await addHolding(store, ALICE, second.id, 'BTC');
    await addHolding(store, ALICE, second.id, 'ETH');
    await addHolding(store, ALICE, second.id, 'SOL');
    await store.holdings.setPrice(write, priced.id, 1_850_000n, 'manual', clock.now());
    await store.holdings.setPrice(write, otherPriced.id, 5_000_000n, 'manual', clock.now());

    const view = await get.execute(await scopeFor(ALICE, 'read'), first.id);

    expect(view.holdings.map((h) => h.ticker)).toEqual(['AAPL', 'MELI']);
    expect(view.totals).toEqual([{ currency: 'ARS', value: 18_500_000n }]);
    expect(view.holdingsWithoutPrice).toBe(1);
    expect(store.calls).toContain('holdings.listByPortfolio');
  });

  it('answers not found when reading a portfolio outside the scope or missing (AC-15)', async () => {
    const { create, get } = setup();
    const created = await create.execute(await scopeFor(ALICE, 'write'), 'Balanz');

    await expect(get.execute(await scopeFor(BOB, 'read'), created.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(get.execute(await scopeFor(ALICE, 'read'), randomUUID())).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });

  it('answers not found when deleting a foreign portfolio and changes nothing (AC-15)', async () => {
    const { create, remove, store } = setup();
    const created = await create.execute(await scopeFor(ALICE, 'write'), 'Balanz');
    await addHolding(store, ALICE, created.id);

    await expect(remove.execute(await scopeFor(BOB, 'write'), created.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );

    expect(store.portfolioRows.size).toBe(1);
    expect(store.holdingRows.size).toBe(1);
  });

  it('answers not found when deleting a missing portfolio (AC-15)', async () => {
    const { remove } = setup();

    await expect(
      remove.execute(await scopeFor(ALICE, 'write'), randomUUID()),
    ).rejects.toBeInstanceOf(ResourceNotFound);
  });

  it('deletes a portfolio together with its holdings (AC-17)', async () => {
    const { create, remove, store } = setup();
    const created = await create.execute(await scopeFor(ALICE, 'write'), 'Balanz');
    const other = await create.execute(await scopeFor(ALICE, 'write'), 'Other');
    await addHolding(store, ALICE, created.id);
    await addHolding(store, ALICE, other.id);

    await remove.execute(await scopeFor(ALICE, 'write'), created.id);

    expect([...store.portfolioRows.keys()]).toEqual([other.id]);
    expect([...store.holdingRows.values()].map((r) => r.holding.portfolioId)).toEqual([other.id]);
  });
});
