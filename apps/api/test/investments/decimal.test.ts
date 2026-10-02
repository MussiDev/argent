import { describe, expect, it } from 'vitest';
import { QUANTITY_SCALE, formatScaledDecimal, parseScaledDecimal } from '@pesly/shared';

const SCALE = QUANTITY_SCALE;

describe('parseScaledDecimal / formatScaledDecimal', () => {
  it('parses 10.5 and round-trips', () => {
    expect(parseScaledDecimal('10.5', SCALE)).toBe(1_050_000_000n);
    expect(formatScaledDecimal(1_050_000_000n, SCALE)).toBe('10.5');
    expect(parseScaledDecimal(formatScaledDecimal(123_456_789n, SCALE), SCALE)).toBe(123_456_789n);
  });

  it('parses integers and the maximum decimals', () => {
    expect(parseScaledDecimal('3', SCALE)).toBe(300_000_000n);
    expect(parseScaledDecimal('0.00000001', SCALE)).toBe(1n);
    expect(formatScaledDecimal(300_000_000n, SCALE)).toBe('3');
    expect(formatScaledDecimal(1n, SCALE)).toBe('0.00000001');
    expect(formatScaledDecimal(0n, SCALE)).toBe('0');
  });

  it('works with a scale of 100 (minor units)', () => {
    expect(parseScaledDecimal('18500.5', 100n)).toBe(1_850_050n);
    expect(parseScaledDecimal('1.234', 100n)).toBeNull();
  });

  it.each(['1e3', '-1', '1.123456789', '', '.', '1.', '.5', '1..2', 'abc', ' 1', '1,5'])(
    'returns null for invalid text %j',
    (text) => {
      expect(parseScaledDecimal(text, SCALE)).toBeNull();
    },
  );

  it.each([0n, -100n, 5n, 150n, 1_000_001n])('throws RangeError for scale %s', (scale) => {
    expect(() => parseScaledDecimal('1', scale)).toThrow(RangeError);
    expect(() => formatScaledDecimal(1n, scale)).toThrow(RangeError);
  });

  it('accepts scale 1 (no decimals)', () => {
    expect(parseScaledDecimal('7', 1n)).toBe(7n);
    expect(parseScaledDecimal('7.1', 1n)).toBeNull();
    expect(formatScaledDecimal(7n, 1n)).toBe('7');
  });

  it('returns null beyond 40 characters and accepts exactly 40', () => {
    expect(parseScaledDecimal('1'.repeat(40), SCALE)).toBe(BigInt('1'.repeat(40)) * SCALE);
    expect(parseScaledDecimal('1'.repeat(41), SCALE)).toBeNull();
    expect(parseScaledDecimal('0'.repeat(500), SCALE)).toBeNull();
  });
});
