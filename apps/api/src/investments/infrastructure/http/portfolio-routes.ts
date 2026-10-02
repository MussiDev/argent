import {
  createPortfolioRequestSchema,
  portfolioIdParamsSchema,
  portfolioListResponseSchema,
  portfolioResponseSchema,
} from '@pesly/shared';
import { Router } from 'express';
import type {
  CreatePortfolio,
  DeletePortfolio,
  GetPortfolio,
  ListPortfolios,
} from '../../application/portfolio-use-cases';
import type { AccessPolicy } from '../../../shared/access';
import { validate } from '../../../shared/http/validate';
import type { Logger } from '../../../shared/logging/logger';
import { scopeOf } from './scope';
import { serializePortfolio } from './serializers';

export interface PortfolioRoutesDependencies {
  policy: AccessPolicy;
  logger: Logger;
  createPortfolio: CreatePortfolio;
  listPortfolios: ListPortfolios;
  getPortfolio: GetPortfolio;
  deletePortfolio: DeletePortfolio;
}

/**
 * The portfolio routes, mounted under the module's session and verified-email guards. The user
 * always comes from `auth`; names are never logged (threat R-15).
 */
export function portfolioRoutes({
  policy,
  logger,
  createPortfolio,
  listPortfolios,
  getPortfolio,
  deletePortfolio,
}: PortfolioRoutesDependencies): Router {
  const router = Router();

  router.get(
    '/investments/portfolios',
    validate({ response: portfolioListResponseSchema }, async (_input, { res, auth }) => {
      const scope = await scopeOf(policy, auth, 'read');
      const portfolios = await listPortfolios.execute(scope);
      res.json({ portfolios: portfolios.map(serializePortfolio) });
    }),
  );

  router.get(
    '/investments/portfolios/:portfolioId',
    validate(
      { params: portfolioIdParamsSchema, response: portfolioResponseSchema },
      async ({ params }, { res, auth }) => {
        const scope = await scopeOf(policy, auth, 'read');
        res.json(serializePortfolio(await getPortfolio.execute(scope, params.portfolioId)));
      },
    ),
  );

  router.post(
    '/investments/portfolios',
    validate(
      { body: createPortfolioRequestSchema, response: portfolioResponseSchema },
      async ({ body }, { res, auth, requestId }) => {
        const scope = await scopeOf(policy, auth, 'write');
        const portfolio = await createPortfolio.execute(scope, body.name);
        logger.info(
          {
            requestId,
            userId: scope.userId,
            action: 'portfolio.create',
            portfolioId: portfolio.id,
          },
          'investments.mutation',
        );
        res.status(201).json(serializePortfolio(portfolio));
      },
    ),
  );

  router.delete(
    '/investments/portfolios/:portfolioId',
    validate({ params: portfolioIdParamsSchema }, async ({ params }, { res, auth, requestId }) => {
      const scope = await scopeOf(policy, auth, 'write');
      await deletePortfolio.execute(scope, params.portfolioId);
      logger.info(
        {
          requestId,
          userId: scope.userId,
          action: 'portfolio.delete',
          portfolioId: params.portfolioId,
        },
        'investments.mutation',
      );
      res.sendStatus(204);
    }),
  );

  return router;
}
