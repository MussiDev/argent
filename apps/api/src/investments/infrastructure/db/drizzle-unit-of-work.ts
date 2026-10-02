import type { InvestmentsRepositories, InvestmentsUnitOfWork } from '../../application/ports';
import { DrizzleHoldingRepository } from './drizzle-holding-repository';
import { DrizzlePortfolioRepository } from './drizzle-portfolio-repository';
import type { InvestmentsDb } from './schema';

/** One PostgreSQL transaction per `run`; the repositories handed to `work` are bound to it. */
export class DrizzleInvestmentsUnitOfWork implements InvestmentsUnitOfWork {
  constructor(private readonly db: InvestmentsDb) {}

  run<T>(work: (repositories: InvestmentsRepositories) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) =>
      work({
        portfolios: new DrizzlePortfolioRepository(tx),
        holdings: new DrizzleHoldingRepository(tx),
      }),
    );
  }
}
