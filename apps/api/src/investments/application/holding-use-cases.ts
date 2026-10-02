import type { InstrumentType, ValuationCurrency } from '@pesly/shared';
import { notFoundUnlessAllowed, ResourceNotFound, type AccessScope } from '../../shared/access';
import {
  applyHoldingEdit,
  assertCryptoInUsd,
  mergeHoldings,
  type HoldingEditPatch,
} from '../domain/holding';
import type { Clock, HoldingRepository, InvestmentsUnitOfWork } from './ports';
import { buildHoldingView, type HoldingView } from './portfolio-view';

export interface AddHoldingInput {
  portfolioId: string;
  ticker: string;
  instrumentName: string;
  instrumentType: InstrumentType;
  quantity: bigint;
  valuationCurrency: ValuationCurrency;
  totalCost?: bigint | null;
}

export interface AddHoldingResult {
  holding: HoldingView;
  merged: boolean;
}

export class AddHolding {
  constructor(
    private readonly unitOfWork: InvestmentsUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(scope: AccessScope<'write'>, input: AddHoldingInput): Promise<AddHoldingResult> {
    const totalCost = input.totalCost ?? null;
    const { holding, merged } = await this.unitOfWork.run(async ({ portfolios, holdings }) => {
      // The portfolio lock serializes concurrent adds of one ticker.
      const portfolio = notFoundUnlessAllowed(await portfolios.lockById(scope, input.portfolioId));
      const existing = await holdings.findByTicker(scope, portfolio.id, input.ticker);

      if (existing === null) {
        assertCryptoInUsd(input.instrumentType, input.valuationCurrency);
        const inserted = notFoundUnlessAllowed(
          await holdings.insert(scope, portfolio.id, {
            ticker: input.ticker,
            instrumentName: input.instrumentName,
            instrumentType: input.instrumentType,
            quantity: input.quantity,
            valuationCurrency: input.valuationCurrency,
            totalCost,
          }),
        );
        return { holding: inserted, merged: false };
      }

      const resolved = mergeHoldings(existing, {
        quantity: input.quantity,
        valuationCurrency: input.valuationCurrency,
        totalCost,
      });
      const updated = notFoundUnlessAllowed(
        await holdings.update(scope, existing.id, {
          quantity: resolved.quantity,
          totalCost: resolved.totalCost,
          valuationCurrency: resolved.valuationCurrency,
          price: resolved.price,
        }),
      );
      return { holding: updated, merged: true };
    });
    return { holding: buildHoldingView(holding, this.clock.now()), merged };
  }
}

export class GetHolding {
  constructor(
    private readonly holdings: HoldingRepository,
    private readonly clock: Clock,
  ) {}

  async execute(scope: AccessScope, holdingId: string): Promise<HoldingView> {
    const holding = notFoundUnlessAllowed(await this.holdings.findById(scope, holdingId));
    return buildHoldingView(holding, this.clock.now());
  }
}

export class UpdateHolding {
  constructor(
    private readonly unitOfWork: InvestmentsUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(
    scope: AccessScope<'write'>,
    holdingId: string,
    patch: HoldingEditPatch,
  ): Promise<HoldingView> {
    const updated = await this.unitOfWork.run(async ({ holdings }) => {
      const existing = notFoundUnlessAllowed(await holdings.findForUpdate(scope, holdingId));
      const resolved = applyHoldingEdit(existing, patch);
      return notFoundUnlessAllowed(
        await holdings.update(scope, holdingId, {
          quantity: resolved.quantity,
          totalCost: resolved.totalCost,
          valuationCurrency: resolved.valuationCurrency,
          price: resolved.price,
        }),
      );
    });
    return buildHoldingView(updated, this.clock.now());
  }
}

export class SetManualPrice {
  constructor(
    private readonly holdings: HoldingRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    scope: AccessScope<'write'>,
    holdingId: string,
    unitPrice: bigint,
  ): Promise<HoldingView> {
    const now = this.clock.now();
    const holding = notFoundUnlessAllowed(
      await this.holdings.setPrice(scope, holdingId, unitPrice, 'manual', now),
    );
    return buildHoldingView(holding, now);
  }
}

export class DeleteHolding {
  constructor(private readonly holdings: HoldingRepository) {}

  async execute(scope: AccessScope<'write'>, holdingId: string): Promise<void> {
    if (!(await this.holdings.delete(scope, holdingId))) throw new ResourceNotFound();
  }
}
