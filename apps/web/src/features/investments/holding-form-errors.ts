import type { ApiFailure } from '@/lib/api-client';
import type { DecimalInputError } from './decimal-input';

/** Keys of `investments.errors` in the i18n catalogs. */
export type InvestmentErrorKey =
  | 'network'
  | 'retryLater'
  | 'unexpected'
  | 'currencyMismatch'
  | 'costRequired'
  | 'cryptoOnlyUsd'
  | 'notFound'
  | 'nameRequired'
  | 'nameTooLong'
  | 'tickerInvalid'
  | 'instrumentNameRequired'
  | 'instrumentNameTooLong'
  | 'ambiguousSeparator'
  | 'empty'
  | 'notANumber'
  | 'tooManyDecimals'
  | 'notPositive'
  | 'quantityInvalid'
  | 'amountInvalid';

export type HoldingField =
  | 'name'
  | 'ticker'
  | 'instrumentName'
  | 'quantity'
  | 'valuationCurrency'
  | 'totalCost'
  | 'unitPrice';

/** What an investment form shows: one message above the fields and/or one message per field. */
export interface HoldingFormErrors {
  form?: InvestmentErrorKey;
  fields?: Partial<Record<HoldingField, InvestmentErrorKey>>;
}

/**
 * Which request failed: the same API field can need a different message in each, and a request
 * only owns some fields (a `body.name` failure on a price request is not a field of that form).
 * - `portfolio`: create a portfolio (`name`).
 * - `add`: add a holding (`quantity`, `valuationCurrency`, `totalCost`).
 * - `edit`: update a holding (same fields as `add`; the cost is also what a currency change needs).
 * - `price`: set a manual price (`unitPrice`).
 */
export type HoldingFormContext = 'portfolio' | 'add' | 'edit' | 'price';

/** The typed-number errors are named after their catalog keys. */
export function decimalErrorKey(error: DecimalInputError): InvestmentErrorKey {
  return error;
}

type FieldErrors = NonNullable<HoldingFormErrors['fields']>;

/**
 * What each API field shows in each request. The API only names the field, never the rule that
 * failed, so `body.name` is `nameRequired`: the form already checked the length, and an empty
 * name is the only way left for the API to reject it.
 */
const API_FIELDS: Record<
  HoldingFormContext,
  Partial<Record<string, [HoldingField, InvestmentErrorKey]>>
> = {
  portfolio: { 'body.name': ['name', 'nameRequired'] },
  add: {
    'body.valuationCurrency': ['valuationCurrency', 'currencyMismatch'],
    'body.totalCost': ['totalCost', 'amountInvalid'],
    'body.quantity': ['quantity', 'quantityInvalid'],
  },
  edit: {
    'body.valuationCurrency': ['valuationCurrency', 'cryptoOnlyUsd'],
    'body.totalCost': ['totalCost', 'costRequired'],
    'body.quantity': ['quantity', 'quantityInvalid'],
  },
  price: { 'body.unitPrice': ['unitPrice', 'amountInvalid'] },
};

function fieldErrors(fields: readonly string[], context: HoldingFormContext): FieldErrors {
  const placed: FieldErrors = {};
  for (const name of fields) {
    const mapped = API_FIELDS[context][name];
    if (mapped) placed[mapped[0]] = mapped[1];
  }
  return placed;
}

/**
 * An API failure as form errors: invalid request fields go next to their field, everything else
 * is one message above the form. The API never sends text, only codes and field names.
 */
export function toHoldingFailure(
  failure: ApiFailure,
  context: HoldingFormContext,
): HoldingFormErrors {
  if (failure.code === 'NETWORK') return { form: 'network' };
  if (failure.code === 'RATE_LIMITED') return { form: 'retryLater' };
  if (failure.code === 'NOT_FOUND') return { form: 'notFound' };
  if (failure.code === 'VALIDATION_FAILED' && failure.fields) {
    const fields = fieldErrors(failure.fields, context);
    if (Object.keys(fields).length > 0) return { fields };
  }
  return { form: 'unexpected' };
}
