import { z } from 'zod';

/** The seven ARS/USD quotes. Consumed by the exchange-rates module. */
export const RATE_TYPES = [
  'oficial',
  'blue',
  'mep',
  'ccl',
  'mayorista',
  'cripto',
  'tarjeta',
] as const;

export const rateTypeSchema = z.enum(RATE_TYPES);

export type RateType = z.infer<typeof rateTypeSchema>;
