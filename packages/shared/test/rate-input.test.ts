import { describe, expect, it } from 'vitest';
import { formatRateInput, parseRateInput } from '../src';

describe('rate input', () => {
  it('round-trips 1623,3 (es) and 1623.3 (en) to 16233000n (AC-08)', () => {
    expect(parseRateInput('1623,3', 'es')).toBe(16233000n);
    expect(parseRateInput('1623.3', 'en')).toBe(16233000n);
    expect(formatRateInput(16233000n, 'es')).toBe('1623,3');
    expect(formatRateInput(16233000n, 'en')).toBe('1623.3');
  });

  it('handles whole numbers, four decimals and grouping', () => {
    expect(parseRateInput('1500', 'es')).toBe(15000000n);
    expect(parseRateInput('0,0001', 'es')).toBe(1n);
    expect(parseRateInput('1.234,5678', 'es')).toBe(12345678n);
    expect(parseRateInput('1,234.5678', 'en')).toBe(12345678n);
    expect(formatRateInput(15000000n, 'es')).toBe('1500');
    expect(formatRateInput(1n, 'en')).toBe('0.0001');
    expect(formatRateInput(12345678n, 'es')).toBe('1234,5678');
  });

  it('does not throw for a malformed locale tag and falls back to "." and ","', () => {
    expect(() => parseRateInput('1623.3', 'x')).not.toThrow();
    expect(parseRateInput('1,623.3', 'x')).toBe(16233000n);
    expect(formatRateInput(16233000n, 'x')).toBe('1623.3');
  });

  it('returns null for malformed text, more than 4 decimals, zero and above the maximum (AC-08)', () => {
    for (const text of [
      '',
      'abc',
      '1,2,3',
      '1623,33333',
      '0',
      '0,0000',
      '-5',
      '1623,3x',
      '100000001',
    ]) {
      expect(parseRateInput(text, 'es'), text).toBeNull();
    }
    expect(parseRateInput('1623.33333', 'en')).toBeNull();
    expect(parseRateInput('10000000,0001', 'es')).toBeNull();
    expect(parseRateInput('10000000', 'es')).toBe(100000000000n);
  });
});
