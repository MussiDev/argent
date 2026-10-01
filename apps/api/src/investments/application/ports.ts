import type { InstrumentType, PriceSource, ValuationCurrency } from '@pesly/shared';
import type { Holding, HoldingPrice } from '../domain/holding';
import type { AccessScope } from '../../shared/access';

export interface Portfolio {
  id: string;
  name: string;
  createdAt: Date;
}

/** A holding to insert; the database assigns the id and it starts without a price. */
export interface HoldingDraft {
  ticker: string;
  instrumentName: string;
  instrumentType: InstrumentType;
  quantity: bigint;
  valuationCurrency: ValuationCurrency;
  totalCost: bigint | null;
}

/** The editable state of a holding exactly as the domain resolved it; the price is null when cleared. */
export interface HoldingUpdate {
  quantity: bigint;
  totalCost: bigint | null;
  valuationCurrency: ValuationCurrency;
  price: HoldingPrice | null;
}

/** Every method answers null or false for rows that do not exist or are outside the scope. */
export interface PortfolioRepository {
  create(scope: AccessScope<'write'>, name: string): Promise<Portfolio>;
  listForOwner(scope: AccessScope): Promise<Portfolio[]>;
  findById(scope: AccessScope, id: string): Promise<Portfolio | null>;
  /** SELECT FOR UPDATE; only meaningful inside a unit of work. */
  lockById(scope: AccessScope<'write'>, id: string): Promise<Portfolio | null>;
  delete(scope: AccessScope<'write'>, id: string): Promise<boolean>;
}

export interface HoldingRepository {
  /** All holdings of the caller across portfolios. */
  listByOwner(scope: AccessScope): Promise<Holding[]>;
  /** The holdings of one portfolio, filtered in the same scoped statement. */
  listByPortfolio(scope: AccessScope, portfolioId: string): Promise<Holding[]>;
  findById(scope: AccessScope, id: string): Promise<Holding | null>;
  /** SELECT FOR UPDATE; only meaningful inside a unit of work. */
  findForUpdate(scope: AccessScope<'write'>, id: string): Promise<Holding | null>;
  /** Case-insensitive ticker lookup inside one portfolio. */
  findByTicker(
    scope: AccessScope<'write'>,
    portfolioId: string,
    ticker: string,
  ): Promise<Holding | null>;
  insert(
    scope: AccessScope<'write'>,
    portfolioId: string,
    draft: HoldingDraft,
  ): Promise<Holding | null>;
  /** Writes the resolved state as given, including a null price; it applies no rules of its own. */
  update(scope: AccessScope<'write'>, id: string, fields: HoldingUpdate): Promise<Holding | null>;
  setPrice(
    scope: AccessScope<'write'>,
    id: string,
    unitPrice: bigint,
    source: PriceSource,
    pricedAt: Date,
  ): Promise<Holding | null>;
  delete(scope: AccessScope<'write'>, id: string): Promise<boolean>;
}

/** Repositories bound to one transaction. */
export interface InvestmentsRepositories {
  portfolios: PortfolioRepository;
  holdings: HoldingRepository;
}

/**
 * Runs `work` atomically: every write through the given repositories commits together, or none
 * does if `work` rejects.
 */
export interface InvestmentsUnitOfWork {
  run<T>(work: (repositories: InvestmentsRepositories) => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}
