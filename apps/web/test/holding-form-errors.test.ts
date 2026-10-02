import { describe, expect, it } from 'vitest';
import { decimalErrorKey, toHoldingFailure } from '../src/features/investments/holding-form-errors';
import type { ApiFailure } from '../src/lib/api-client';

function failure(overrides: Partial<ApiFailure>): ApiFailure {
  return { ok: false, code: 'INTERNAL', messageKey: 'unexpected', ...overrides };
}

describe('toHoldingFailure', () => {
  it('maps body.valuationCurrency to the currency mismatch message when adding (AC-24)', () => {
    const errors = toHoldingFailure(
      failure({
        code: 'VALIDATION_FAILED',
        messageKey: 'validationFailed',
        fields: ['body.valuationCurrency'],
      }),
      'add',
    );

    expect(errors.fields?.valuationCurrency).toBe('currencyMismatch');
  });

  it('maps body.valuationCurrency to crypto-only-USD when editing', () => {
    const errors = toHoldingFailure(
      failure({
        code: 'VALIDATION_FAILED',
        messageKey: 'validationFailed',
        fields: ['body.valuationCurrency'],
      }),
      'edit',
    );

    expect(errors.fields?.valuationCurrency).toBe('cryptoOnlyUsd');
  });

  it('maps body.totalCost to the cost-required message (FR-17)', () => {
    const errors = toHoldingFailure(
      failure({
        code: 'VALIDATION_FAILED',
        messageKey: 'validationFailed',
        fields: ['body.totalCost'],
      }),
      'edit',
    );

    expect(errors.fields?.totalCost).toBe('costRequired');
  });

  it('maps body.quantity and body.unitPrice to their own keys', () => {
    expect(
      toHoldingFailure(failure({ code: 'VALIDATION_FAILED', fields: ['body.quantity'] }), 'add')
        .fields?.quantity,
    ).toBe('quantityInvalid');
    expect(
      toHoldingFailure(failure({ code: 'VALIDATION_FAILED', fields: ['body.unitPrice'] }), 'price')
        .fields?.unitPrice,
    ).toBe('amountInvalid');
  });

  it('maps a network failure to the network key', () => {
    expect(toHoldingFailure(failure({ code: 'NETWORK', messageKey: 'network' }), 'add')).toEqual({
      form: 'network',
    });
  });

  it('maps a rate limit to the retry-later key', () => {
    expect(
      toHoldingFailure(failure({ code: 'RATE_LIMITED', messageKey: 'retryLater' }), 'add').form,
    ).toBe('retryLater');
  });

  it('maps a 404 to the not-found key', () => {
    expect(toHoldingFailure(failure({ code: 'NOT_FOUND' }), 'edit').form).toBe('notFound');
  });

  it('maps an unexpected 500 to the generic key', () => {
    expect(toHoldingFailure(failure({ code: 'INTERNAL' }), 'add')).toEqual({ form: 'unexpected' });
  });

  it('falls back to the generic key for validation failures it cannot place', () => {
    expect(
      toHoldingFailure(failure({ code: 'VALIDATION_FAILED', fields: ['body.other'] }), 'add').form,
    ).toBe('unexpected');
  });
});

describe('toHoldingFailure by context', () => {
  const invalid = (fields?: string[]) =>
    failure({ code: 'VALIDATION_FAILED', messageKey: 'validationFailed', fields });

  it('maps body.unitPrice to the amount message in the price context', () => {
    expect(toHoldingFailure(invalid(['body.unitPrice']), 'price')).toEqual({
      fields: { unitPrice: 'amountInvalid' },
    });
  });

  it('maps body.name to the name message in the portfolio context', () => {
    expect(toHoldingFailure(invalid(['body.name']), 'portfolio')).toEqual({
      fields: { name: 'nameRequired' },
    });
  });

  it('does not place a field that the request of the context does not have', () => {
    expect(toHoldingFailure(invalid(['body.quantity']), 'price')).toEqual({ form: 'unexpected' });
    expect(toHoldingFailure(invalid(['body.unitPrice']), 'portfolio')).toEqual({
      form: 'unexpected',
    });
    expect(toHoldingFailure(invalid(['body.name']), 'add')).toEqual({ form: 'unexpected' });
  });

  it('uses the amount message for the total cost when adding', () => {
    expect(toHoldingFailure(invalid(['body.totalCost']), 'add')).toEqual({
      fields: { totalCost: 'amountInvalid' },
    });
  });

  it('places several fields at once', () => {
    expect(
      toHoldingFailure(invalid(['body.quantity', 'body.totalCost', 'body.other']), 'edit'),
    ).toEqual({ fields: { quantity: 'quantityInvalid', totalCost: 'costRequired' } });
  });

  it('falls back to the generic key when the validation failure has no fields', () => {
    expect(toHoldingFailure(invalid(undefined), 'add')).toEqual({ form: 'unexpected' });
    expect(toHoldingFailure(invalid([]), 'edit')).toEqual({ form: 'unexpected' });
  });
});

describe('decimalErrorKey', () => {
  it.each(['empty', 'notANumber', 'tooManyDecimals', 'notPositive', 'ambiguousSeparator'] as const)(
    'maps %s to its own key',
    (error) => {
      expect(decimalErrorKey(error)).toBe(error);
    },
  );
});
