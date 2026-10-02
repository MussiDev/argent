import { Router } from 'express';
import type { RouterFactory } from '../app';
import { OwnerOrGroupMemberAccessPolicy } from '../shared/access';
import { DenyAllGroupMembershipReader } from '../shared/access/infrastructure/deny-all-group-membership-reader';
import { requireVerifiedEmail } from '../shared/http/require-verified-email';
import type { Logger } from '../shared/logging/logger';
import {
  CreatePortfolio,
  DeletePortfolio,
  GetPortfolio,
  ListPortfolios,
} from './application/portfolio-use-cases';
import type { Clock } from './application/ports';
import { DrizzleHoldingRepository } from './infrastructure/db/drizzle-holding-repository';
import { DrizzlePortfolioRepository } from './infrastructure/db/drizzle-portfolio-repository';
import type { InvestmentsDb } from './infrastructure/db/schema';
import { portfolioRoutes } from './infrastructure/http/portfolio-routes';
import { systemClock } from './infrastructure/system-clock';

export interface InvestmentsRoutesOptions {
  db: InvestmentsDb;
  /** Defaults to the module's own system clock. */
  clock?: Clock;
  logger: Logger;
}

/** Composition root of the investments module: repositories, use cases, policy and routers. */
export function createInvestmentsRoutes({
  db,
  clock = systemClock,
  logger,
}: InvestmentsRoutesOptions): RouterFactory {
  // No group sharing until PRD 05: nobody is a member, so only owners see their rows.
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
  const portfolios = new DrizzlePortfolioRepository(db);
  const holdings = new DrizzleHoldingRepository(db);

  return ({ requireSession }) => {
    const router = Router();
    router.use('/investments', requireSession, requireVerifiedEmail);
    router.use(
      portfolioRoutes({
        policy,
        logger,
        createPortfolio: new CreatePortfolio(portfolios, clock),
        listPortfolios: new ListPortfolios(portfolios, holdings, clock),
        getPortfolio: new GetPortfolio(portfolios, holdings, clock),
        deletePortfolio: new DeletePortfolio(portfolios),
      }),
    );
    return router;
  };
}
