import { z } from 'zod';
import { rateTypeSchema } from '../rate-types';
import { RATE_MAX_SCALED } from './scaled-rate';

/** A rate scaled by 10,000 as a decimal integer string, within 1..RATE_MAX_SCALED. */
export const scaledRateStringSchema = z
  .string()
  .regex(/^[1-9]\d{0,11}$/, 'Rate must be a positive integer string of at most 12 digits')
  .refine((text) => /^\d+$/.test(text) && BigInt(text) <= RATE_MAX_SCALED, {
    message: `Rate must not exceed ${RATE_MAX_SCALED}`,
  });

export const exchangeRateSchema = z.object({
  rateType: rateTypeSchema,
  buy: scaledRateStringSchema,
  sell: scaledRateStringSchema,
  providerUpdatedAt: z.iso.datetime(),
  fetchedAt: z.iso.datetime(),
});
export type ExchangeRate = z.infer<typeof exchangeRateSchema>;

export const latestRatesResponseSchema = z.object({
  rates: z.array(exchangeRateSchema),
});
export type LatestRatesResponse = z.infer<typeof latestRatesResponseSchema>;

/** The module takes no query input; unknown keys are stripped. */
export const latestRatesQuerySchema = z.object({});
export type LatestRatesQuery = z.infer<typeof latestRatesQuerySchema>;
