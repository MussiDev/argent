import { describe, expect, it } from 'vitest';
import { MAX_TEXT_LENGTH } from '@pesly/shared';
import { parseAmountInput, parseQuantityInput } from '../src/features/investments/decimal-input';

describe('parseQuantityInput', () => {
  it.each(['10,5', '10.5', ' 10.5 '])('turns "%s" into 1050000000 in Spanish (AC-02)', (text) => {
    expect(parseQuantityInput(text, 'es')).toEqual({ ok: true, value: '1050000000' });
  });

  it.each(['10,5', '10.5'])('turns "%s" into 1050000000 in English (AC-02)', (text) => {
    expect(parseQuantityInput(text, 'en')).toEqual({ ok: true, value: '1050000000' });
  });

  it('accepts 8 decimals (AC-02)', () => {
    expect(parseQuantityInput('0.00000001', 'en')).toEqual({ ok: true, value: '1' });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'notANumber'],
    ['.', 'notANumber'],
    ['+5', 'notANumber'],
    ['1,2,3', 'notANumber'],
    ['0', 'notPositive'],
    ['0.00', 'notPositive'],
    ['-0', 'notPositive'],
    ['-1', 'notPositive'],
    ['1.123456789', 'tooManyDecimals'],
  ])('rejects "%s" with %s (AC-03, AC-08)', (text, error) => {
    expect(parseQuantityInput(text, 'en')).toEqual({ ok: false, error });
    expect(parseQuantityInput(text, 'es')).toEqual({ ok: false, error });
  });

  it('rejects the foreign separator before exactly three digits as ambiguous (AC-03)', () => {
    expect(parseQuantityInput('1.000', 'es')).toEqual({ ok: false, error: 'ambiguousSeparator' });
    expect(parseQuantityInput('1,000', 'en')).toEqual({ ok: false, error: 'ambiguousSeparator' });
    expect(parseQuantityInput('1.500', 'es')).toEqual({ ok: false, error: 'ambiguousSeparator' });
    expect(parseQuantityInput('1,500', 'en')).toEqual({ ok: false, error: 'ambiguousSeparator' });
    expect(parseQuantityInput('007.000', 'es')).toEqual({
      ok: false,
      error: 'ambiguousSeparator',
    });
  });

  it('keeps the own decimal separator valid before three digits (AC-02)', () => {
    expect(parseQuantityInput('1,000', 'es')).toEqual({ ok: true, value: '100000000' });
    expect(parseQuantityInput('1.000', 'en')).toEqual({ ok: true, value: '100000000' });
    expect(parseQuantityInput('1.5', 'es')).toEqual({ ok: true, value: '150000000' });
    expect(parseQuantityInput('1,5', 'en')).toEqual({ ok: true, value: '150000000' });
  });

  it('allows the foreign separator after a zero whole part, it cannot be a thousands mark', () => {
    // "0.001" has no thousands reading, so it is the decimal 0.001 in both languages.
    expect(parseQuantityInput('0.001', 'es')).toEqual({ ok: true, value: '100000' });
    expect(parseQuantityInput('0,001', 'en')).toEqual({ ok: true, value: '100000' });
    expect(parseQuantityInput('.001', 'es')).toEqual({ ok: true, value: '100000' });
  });

  it('accepts a leading or trailing separator and leading zeros (AC-02)', () => {
    expect(parseQuantityInput('.5', 'en')).toEqual({ ok: true, value: '50000000' });
    expect(parseQuantityInput('5.', 'en')).toEqual({ ok: true, value: '500000000' });
    expect(parseQuantityInput('5,', 'es')).toEqual({ ok: true, value: '500000000' });
    expect(parseQuantityInput('007', 'es')).toEqual({ ok: true, value: '700000000' });
    expect(parseQuantityInput('00.5', 'en')).toEqual({ ok: true, value: '50000000' });
  });

  it('rejects text longer than the shared limit as not a number (AC-03)', () => {
    const tooLong = '1'.repeat(MAX_TEXT_LENGTH + 1);
    expect(parseQuantityInput(tooLong, 'en')).toEqual({ ok: false, error: 'notANumber' });
    const atLimit = `0.${'0'.repeat(MAX_TEXT_LENGTH - 3)}1`;
    expect(atLimit).toHaveLength(MAX_TEXT_LENGTH);
    expect(parseQuantityInput(atLimit, 'en')).toEqual({ ok: false, error: 'tooManyDecimals' });
  });

  it('counts the zero it adds to ".5" style text toward the limit', () => {
    const edge = `.${'1'.repeat(MAX_TEXT_LENGTH)}`;
    expect(parseQuantityInput(edge, 'en')).toEqual({ ok: false, error: 'notANumber' });
  });
});

describe('parseAmountInput', () => {
  it('turns "18500.00" into 1850000 (AC-02)', () => {
    expect(parseAmountInput('18500.00', 'en')).toEqual({ ok: true, value: '1850000' });
  });

  it('turns "18500,5" into 1850050 (AC-02)', () => {
    expect(parseAmountInput('18500,5', 'es')).toEqual({ ok: true, value: '1850050' });
    expect(parseAmountInput('18500,5', 'en')).toEqual({ ok: true, value: '1850050' });
  });

  it('rejects a third decimal on the own separator (AC-03)', () => {
    expect(parseAmountInput('1.234', 'en')).toEqual({ ok: false, error: 'tooManyDecimals' });
    expect(parseAmountInput('1,234', 'es')).toEqual({ ok: false, error: 'tooManyDecimals' });
    expect(parseAmountInput('0,001', 'es')).toEqual({ ok: false, error: 'tooManyDecimals' });
    expect(parseAmountInput('0,001', 'en')).toEqual({ ok: false, error: 'tooManyDecimals' });
  });

  it('flags "1.234" in Spanish and "1,234" in English as ambiguous (AC-03)', () => {
    expect(parseAmountInput('1.234', 'es')).toEqual({ ok: false, error: 'ambiguousSeparator' });
    expect(parseAmountInput('1,234', 'en')).toEqual({ ok: false, error: 'ambiguousSeparator' });
    expect(parseAmountInput('1.000', 'es')).toEqual({ ok: false, error: 'ambiguousSeparator' });
    expect(parseAmountInput('1,000', 'en')).toEqual({ ok: false, error: 'ambiguousSeparator' });
  });

  it('rejects empty and non numeric text without throwing (AC-03, AC-08)', () => {
    expect(parseAmountInput('', 'es')).toEqual({ ok: false, error: 'empty' });
    expect(parseAmountInput('1e5', 'en')).toEqual({ ok: false, error: 'notANumber' });
  });
});

describe('grouped typed numbers (AC-02)', () => {
  it('reads the language decimal separator after the other one used as thousands mark', () => {
    expect(parseAmountInput('150,000.00', 'en')).toEqual({ ok: true, value: '15000000' });
    expect(parseAmountInput('150.000,00', 'es')).toEqual({ ok: true, value: '15000000' });
    expect(parseAmountInput('1,234.5', 'en')).toEqual({ ok: true, value: '123450' });
    expect(parseAmountInput('1.234,5', 'es')).toEqual({ ok: true, value: '123450' });
    expect(parseQuantityInput('1,000.5', 'en')).toEqual({ ok: true, value: '100050000000' });
    expect(parseQuantityInput('1.000,5', 'es')).toEqual({ ok: true, value: '100050000000' });
    expect(parseAmountInput('1,234,567.89', 'en')).toEqual({ ok: true, value: '123456789' });
    expect(parseAmountInput('1.234.567,89', 'es')).toEqual({ ok: true, value: '123456789' });
  });

  it('rejects the language decimal separator when it is not the last one', () => {
    expect(parseAmountInput('1,234.56', 'es')).toEqual({ ok: false, error: 'notANumber' });
    expect(parseAmountInput('1.234,56', 'en')).toEqual({ ok: false, error: 'notANumber' });
    expect(parseQuantityInput('1.000,5', 'en')).toEqual({ ok: false, error: 'notANumber' });
    expect(parseQuantityInput('1,000.5', 'es')).toEqual({ ok: false, error: 'notANumber' });
  });

  it.each(['1,2,3', '1.2.3', '1,23,456.5', '12,3456.5', ',123.5', '1,000.5.5', '1.5,000'])(
    'rejects the irregular grouping "%s"',
    (text) => {
      expect(parseAmountInput(text, 'en')).toEqual({ ok: false, error: 'notANumber' });
      expect(parseAmountInput(text, 'es')).toEqual({ ok: false, error: 'notANumber' });
    },
  );

  it('accepts a repeated separator in exact groups only as the language group separator', () => {
    expect(parseAmountInput('1,000,000', 'en')).toEqual({ ok: true, value: '100000000' });
    expect(parseAmountInput('1.000.000', 'es')).toEqual({ ok: true, value: '100000000' });
    expect(parseAmountInput('1,000,000', 'es')).toEqual({ ok: false, error: 'notANumber' });
    expect(parseAmountInput('1.000.000', 'en')).toEqual({ ok: false, error: 'notANumber' });
    expect(parseAmountInput('1,00,000', 'en')).toEqual({ ok: false, error: 'notANumber' });
  });

  it('still applies the positive and decimals rules to grouped text', () => {
    expect(parseAmountInput('0,000.00', 'en')).toEqual({ ok: false, error: 'notPositive' });
    expect(parseAmountInput('1,000.123', 'en')).toEqual({ ok: false, error: 'tooManyDecimals' });
  });
});
