// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HoldingFormErrors } from '../src/features/investments/holding-form-errors';
import { useFieldErrors } from '../src/features/investments/use-field-errors';

function setup(initial?: HoldingFormErrors) {
  return renderHook(({ errors }: { errors?: HoldingFormErrors }) => useFieldErrors(errors), {
    initialProps: { errors: initial },
  });
}

describe('useFieldErrors', () => {
  it('starts with the errors the container got from the API', () => {
    const { result } = setup({ form: 'network', fields: { quantity: 'quantityInvalid' } });

    expect(result.current.fields).toEqual({ quantity: 'quantityInvalid' });
    expect(result.current.form).toBe('network');
  });

  it('merges local errors over the API ones, field by field', () => {
    const { result } = setup({
      fields: { quantity: 'quantityInvalid', totalCost: 'costRequired' },
    });

    act(() => {
      result.current.setLocal({ quantity: 'notPositive', ticker: 'tickerInvalid' });
    });

    expect(result.current.fields).toEqual({
      quantity: 'notPositive',
      totalCost: 'costRequired',
      ticker: 'tickerInvalid',
    });
  });

  it('clears the local errors on a valid resubmit and keeps the API ones', () => {
    const { result } = setup({ fields: { totalCost: 'costRequired' } });
    act(() => {
      result.current.setLocal({ quantity: 'notPositive' });
    });

    act(() => {
      result.current.setLocal({});
    });

    expect(result.current.fields).toEqual({ totalCost: 'costRequired' });
  });

  it('asks for focus on every failed submit, even with the same errors', () => {
    const { result } = setup();
    const first = result.current.focus.attempt;

    act(() => {
      result.current.setLocal({ quantity: 'notPositive' });
    });
    const second = result.current.focus.attempt;
    act(() => {
      result.current.setLocal({ quantity: 'notPositive' });
    });

    expect(second).toBeGreaterThan(first);
    expect(result.current.focus.attempt).toBeGreaterThan(second);
  });

  it('does not ask for focus on a valid resubmit, so a stale API error does not steal it', () => {
    const { result } = setup({ fields: { unitPrice: 'amountInvalid' } });
    act(() => {
      result.current.setLocal({ unitPrice: 'notPositive' });
    });
    const before = result.current.focus;

    act(() => {
      result.current.setLocal({});
    });
    const afterClearing = result.current.focus;
    act(() => {
      result.current.setLocal({});
    });

    expect(afterClearing.attempt).toBe(before.attempt);
    expect(afterClearing.api).toBe(before.api);
    expect(result.current.focus.attempt).toBe(before.attempt);
    expect(result.current.fields).toEqual({ unitPrice: 'amountInvalid' });
  });

  it('lets a local form error replace the API one until the next valid submit', () => {
    const { result } = setup({ form: 'network' });

    act(() => {
      result.current.setLocal({}, 'unexpected');
    });
    expect(result.current.form).toBe('unexpected');
    expect(result.current.focus.formError).toBe(true);

    act(() => {
      result.current.setLocal({});
    });
    expect(result.current.form).toBe('network');
    expect(result.current.focus.formError).toBe(false);
  });

  it('follows the API errors when the container sends new ones', () => {
    const { result, rerender } = setup({ fields: { unitPrice: 'amountInvalid' } });

    rerender({ errors: { fields: { unitPrice: 'notPositive' } } });

    expect(result.current.fields).toEqual({ unitPrice: 'notPositive' });
  });
});
