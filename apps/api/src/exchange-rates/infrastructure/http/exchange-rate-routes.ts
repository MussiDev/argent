import { latestRatesQuerySchema, latestRatesResponseSchema } from '@pesly/shared';
import { Router } from 'express';
import type { RouterFactory } from '../../../app';
import type { Database } from '../../../shared/db/client';
import { requireVerifiedEmail } from '../../../shared/http/require-verified-email';
import { validate } from '../../../shared/http/validate';
import { GetLatestRates } from '../../application/get-latest-rates';
import { DrizzleRateRepository } from '../db/drizzle-rate-repository';
import { presentLatestRates } from './exchange-rate-presenter';

export interface ExchangeRateRoutesOptions {
  db: Database;
}

/** `/exchange-rates`: reads stored rates only; the API never reaches the external source. */
export function createExchangeRateRoutes({ db }: ExchangeRateRoutesOptions): RouterFactory {
  const getLatestRates = new GetLatestRates({ rates: new DrizzleRateRepository(db) });

  return ({ requireSession }) => {
    const router = Router();
    router.use('/exchange-rates', requireSession, requireVerifiedEmail);

    router.get(
      '/exchange-rates/latest',
      validate(
        { query: latestRatesQuerySchema, response: latestRatesResponseSchema },
        async (_input, { res }) => {
          res.json(presentLatestRates(await getLatestRates.execute()));
        },
      ),
    );

    return router;
  };
}
