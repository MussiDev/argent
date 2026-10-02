import { notFoundUnlessAllowed, ResourceNotFound, type AccessScope } from '../../shared/access';
import type { Clock, HoldingRepository, PortfolioRepository } from './ports';
import { buildPortfolioView, buildPortfolioViews, type PortfolioView } from './portfolio-view';

export class CreatePortfolio {
  constructor(
    private readonly portfolios: PortfolioRepository,
    private readonly clock: Clock,
  ) {}

  async execute(scope: AccessScope<'write'>, name: string): Promise<PortfolioView> {
    const portfolio = await this.portfolios.create(scope, name);
    return buildPortfolioView(portfolio, [], this.clock.now());
  }
}

export class ListPortfolios {
  constructor(
    private readonly portfolios: PortfolioRepository,
    private readonly holdings: HoldingRepository,
    private readonly clock: Clock,
  ) {}

  async execute(scope: AccessScope): Promise<PortfolioView[]> {
    const [portfolios, holdings] = await Promise.all([
      this.portfolios.listForOwner(scope),
      this.holdings.listByOwner(scope),
    ]);
    return buildPortfolioViews(portfolios, holdings, this.clock.now());
  }
}

export class GetPortfolio {
  constructor(
    private readonly portfolios: PortfolioRepository,
    private readonly holdings: HoldingRepository,
    private readonly clock: Clock,
  ) {}

  async execute(scope: AccessScope, portfolioId: string): Promise<PortfolioView> {
    const portfolio = notFoundUnlessAllowed(await this.portfolios.findById(scope, portfolioId));
    const holdings = await this.holdings.listByPortfolio(scope, portfolio.id);
    return buildPortfolioView(portfolio, holdings, this.clock.now());
  }
}

export class DeletePortfolio {
  constructor(private readonly portfolios: PortfolioRepository) {}

  /** Holdings go with it through the repository's cascade. */
  async execute(scope: AccessScope<'write'>, portfolioId: string): Promise<void> {
    if (!(await this.portfolios.delete(scope, portfolioId))) throw new ResourceNotFound();
  }
}
