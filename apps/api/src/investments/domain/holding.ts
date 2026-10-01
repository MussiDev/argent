import {
  QUANTITY_MAX,
  TOTAL_COST_MAX,
  type InstrumentType,
  type PriceSource,
  type ValuationCurrency,
} from '@pesly/shared';
import { InvestmentRuleViolation } from './errors';

export interface HoldingPrice {
  unitPrice: bigint;
  source: PriceSource;
  pricedAt: Date;
}

export interface Holding {
  id: string;
  portfolioId: string;
  ticker: string;
  instrumentName: string;
  instrumentType: InstrumentType;
  /** Scaled by 10^8. */
  quantity: bigint;
  valuationCurrency: ValuationCurrency;
  /** Minor units of the valuation currency. */
  totalCost: bigint | null;
  price: HoldingPrice | null;
}

export interface HoldingEditPatch {
  quantity?: bigint;
  /** A key set to null clears the cost; an absent key keeps it. */
  totalCost?: bigint | null;
  valuationCurrency?: ValuationCurrency;
}

export function assertCryptoInUsd(type: InstrumentType, currency: ValuationCurrency): void {
  if (type === 'crypto' && currency !== 'USD') {
    throw new InvestmentRuleViolation('valuationCurrency');
  }
}

/** The part of a holding being added that a merge needs; it has no id or price yet. */
export type IncomingHolding = Pick<Holding, 'quantity' | 'valuationCurrency' | 'totalCost'>;

export function mergeHoldings(existing: Holding, incoming: IncomingHolding): Holding {
  if (existing.valuationCurrency !== incoming.valuationCurrency) {
    throw new InvestmentRuleViolation('valuationCurrency');
  }

  const quantity = existing.quantity + incoming.quantity;
  if (quantity > QUANTITY_MAX) throw new InvestmentRuleViolation('quantity');

  const totalCost =
    existing.totalCost === null || incoming.totalCost === null
      ? null
      : existing.totalCost + incoming.totalCost;
  if (totalCost !== null && totalCost > TOTAL_COST_MAX) {
    throw new InvestmentRuleViolation('totalCost');
  }

  return { ...existing, quantity, totalCost };
}

export function applyHoldingEdit(existing: Holding, patch: HoldingEditPatch): Holding {
  const valuationCurrency = patch.valuationCurrency ?? existing.valuationCurrency;
  const currencyChanged = valuationCurrency !== existing.valuationCurrency;

  assertCryptoInUsd(existing.instrumentType, valuationCurrency);
  // The old cost is in the old currency, so it cannot silently carry over.
  if (currencyChanged && patch.totalCost === undefined) {
    throw new InvestmentRuleViolation('totalCost');
  }

  return {
    ...existing,
    quantity: patch.quantity ?? existing.quantity,
    totalCost: patch.totalCost === undefined ? existing.totalCost : patch.totalCost,
    valuationCurrency,
    price: currencyChanged ? null : existing.price,
  };
}
