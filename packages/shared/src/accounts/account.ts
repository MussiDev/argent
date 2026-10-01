import { z } from 'zod';
import { minorUnitsStringSchema } from '../money';

export const ACCOUNT_TYPES = [
  'cash',
  'bank_account',
  'digital_wallet',
  'credit_card',
  'savings',
] as const;
export const accountTypeSchema = z.enum(ACCOUNT_TYPES);
export type AccountType = z.infer<typeof accountTypeSchema>;

export const ACCOUNT_CURRENCIES = ['ARS', 'USD'] as const;
export const accountCurrencySchema = z.enum(ACCOUNT_CURRENCIES);
export type AccountCurrency = z.infer<typeof accountCurrencySchema>;

export const ACCOUNT_NAME_MAX_LENGTH = 50;

/** Trimmed, NFC-normalized, 1 to 50 code points (an emoji counts as one). */
export const accountNameSchema = z
  .string()
  .transform((name) => name.normalize('NFC').trim())
  .pipe(
    z.string().refine(
      (name) => {
        const length = Array.from(name).length;
        return length >= 1 && length <= ACCOUNT_NAME_MAX_LENGTH;
      },
      { message: `Name must be 1 to ${ACCOUNT_NAME_MAX_LENGTH} characters` },
    ),
  );

/** `POST /accounts`. The opening balance is optional (absent is "0") and may be negative. */
export const createAccountRequestSchema = z.object({
  name: accountNameSchema,
  type: accountTypeSchema,
  currency: accountCurrencySchema,
  openingBalance: minorUnitsStringSchema.default('0'),
});

export type CreateAccountRequest = z.infer<typeof createAccountRequestSchema>;

/**
 * `PATCH /accounts/:id`. `type` and `currency` are immutable: declaring them as `never` makes
 * sending either a validation failure instead of silently stripping it.
 */
export const renameAccountRequestSchema = z.object({
  name: accountNameSchema,
  type: z.never().optional(),
  currency: z.never().optional(),
});

export type RenameAccountRequest = z.infer<typeof renameAccountRequestSchema>;

export const accountIdParamsSchema = z.object({
  id: z.uuid(),
});

export type AccountIdParams = z.infer<typeof accountIdParamsSchema>;

export const LIST_ACCOUNTS_MAX_LIMIT = 100;
export const LIST_ACCOUNTS_DEFAULT_LIMIT = 50;

/** `z.coerce.number()` turns '' and whitespace into 0; a blank query value must fail instead. */
function queryInteger<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? Number.NaN : value),
    schema,
  );
}

export const listAccountsQuerySchema = z.object({
  archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  limit: queryInteger(z.coerce.number().int().min(1).max(LIST_ACCOUNTS_MAX_LIMIT)).default(
    LIST_ACCOUNTS_DEFAULT_LIMIT,
  ),
  offset: queryInteger(z.coerce.number().int().min(0)).default(0),
});

export type ListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;

export const accountResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: accountTypeSchema,
  currency: accountCurrencySchema,
  openingBalance: minorUnitsStringSchema,
  balance: minorUnitsStringSchema,
  archived: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type AccountResponse = z.infer<typeof accountResponseSchema>;

export const listAccountsResponseSchema = z.object({
  items: z.array(accountResponseSchema),
  totals: z.record(accountCurrencySchema, minorUnitsStringSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1).max(LIST_ACCOUNTS_MAX_LIMIT),
  offset: z.number().int().min(0),
});

export type ListAccountsResponse = z.infer<typeof listAccountsResponseSchema>;
