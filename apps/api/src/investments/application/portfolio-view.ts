import {
  gainOrLoss,
  holdingValue,
  isPriceStale,
  totalsByCurrency,
  type GainOrLoss,
  type ValuationCurrency,
} from '@argent/shared';
import type { Holding } from '../domain/holding';
import type { Portfolio } from './ports';

/** Read model: bigint-valued, serialized to decimal strings only at the HTTP boundary. */
export interface HoldingView extends Holding {
  /** Null without a price ("price needed"). */
  value: bigint | null;
  /** Null without a value or without a total cost. */
  gain: GainOrLoss | null;
  priceStale: boolean;
}

export interface CurrencyTotal {
  currency: ValuationCurrency;
  value: bigint;
}

export interface PortfolioView {
  id: string;
  name: string;
  createdAt: Date;
  totals: CurrencyTotal[];
  holdingsWithoutPrice: number;
  holdings: HoldingView[];
}

const CURRENCY_ORDER: readonly ValuationCurrency[] = ['ARS', 'USD'];

export function buildHoldingView(holding: Holding, now: Date): HoldingView {
  const value =
    holding.price === null ? null : holdingValue(holding.quantity, holding.price.unitPrice);
  const gain =
    value === null || holding.totalCost === null ? null : gainOrLoss(value, holding.totalCost);
  const priceStale = holding.price !== null && isPriceStale(holding.price.pricedAt, now);
  return { ...holding, value, gain, priceStale };
}

function compareTickers(a: Holding, b: Holding): number {
  const left = a.ticker.toLowerCase();
  const right = b.ticker.toLowerCase();
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** Oldest first; equal creation times fall back to a plain id comparison so the order is stable. */
function comparePortfolios(a: Portfolio, b: Portfolio): number {
  const byTime = a.createdAt.getTime() - b.createdAt.getTime();
  if (byTime !== 0) return byTime;
  if (a.id < b.id) return -1;
  return a.id > b.id ? 1 : 0;
}

export function buildPortfolioView(
  portfolio: Portfolio,
  holdings: readonly Holding[],
  now: Date,
): PortfolioView {
  const views = [...holdings].sort(compareTickers).map((holding) => buildHoldingView(holding, now));
  const sums = totalsByCurrency(views);
  // A currency appears only when one of its holdings has a value, so a zero is never invented.
  const totals = CURRENCY_ORDER.filter((currency) =>
    views.some((view) => view.valuationCurrency === currency && view.value !== null),
  ).map((currency) => ({ currency, value: sums[currency] }));

  return {
    id: portfolio.id,
    name: portfolio.name,
    createdAt: portfolio.createdAt,
    totals,
    holdingsWithoutPrice: views.filter((view) => view.price === null).length,
    holdings: views,
  };
}

/** Groups the caller's holdings under their portfolios; portfolios come oldest first. */
export function buildPortfolioViews(
  portfolios: readonly Portfolio[],
  holdings: readonly Holding[],
  now: Date,
): PortfolioView[] {
  const byPortfolio = new Map<string, Holding[]>();
  for (const holding of holdings) {
    const group = byPortfolio.get(holding.portfolioId);
    if (group === undefined) byPortfolio.set(holding.portfolioId, [holding]);
    else group.push(holding);
  }
  return [...portfolios]
    .sort(comparePortfolios)
    .map((portfolio) => buildPortfolioView(portfolio, byPortfolio.get(portfolio.id) ?? [], now));
}
