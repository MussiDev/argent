import { describe, expect, it } from 'vitest';
import {
  RATE_MAX_SCALED,
  RATE_SCALE,
  RATE_SCALE_DECIMALS,
  formatScaledRate,
  parseScaledRate,
} from '../src/exchange-rates/scaled-rate';

describe('parseScaledRate', () => {
  it('scales exact decimal text by 10,000 (NFR-01)', () => {
    expect(parseScaledRate('1623.3')).toBe(16233000n);
    expect(parseScaledRate('1545')).toBe(15450000n);
    expect(parseScaledRate('1614.03')).toBe(16140300n);
    expect(parseScaledRate('0.0001')).toBe(1n);
  });

  it('rounds half up beyond 4 decimals (NFR-01)', () => {
    expect(parseScaledRate('1.00005')).toBe(10001n);
    expect(parseScaledRate('1.00004')).toBe(10000n);
    expect(parseScaledRate('1.99995')).toBe(20000n);
    expect(parseScaledRate('0.00005')).toBe(1n);
  });

  it('returns null for malformed text', () => {
    for (const text of ['', '-1', '+1', '1e3', '1,5', 'abc', ' 1', '1 ', '01', '1.', '.5']) {
      expect(parseScaledRate(text)).toBeNull();
    }
  });

  it('returns null for zero and for values above the maximum', () => {
    expect(parseScaledRate('0')).toBeNull();
    expect(parseScaledRate('0.0000')).toBeNull();
    expect(parseScaledRate('0.00001')).toBeNull();
    expect(parseScaledRate('10000000')).toBe(RATE_MAX_SCALED);
    expect(parseScaledRate('10000000.0001')).toBeNull();
  });

  it('never passes through Number: a 30-digit text keeps every digit (NFR-01)', () => {
    const digits = '123456789012345678901234567890';
    expect(parseScaledRate(digits)).toBeNull();
    expect(formatScaledRate(BigInt(digits))).toBe(`${digits.slice(0, -4)}.${digits.slice(-4)}`);
    expect(parseScaledRate(`0.${'0'.repeat(30)}9`)).toBeNull();
  });

  it('exposes the scale constants', () => {
    expect(RATE_SCALE_DECIMALS).toBe(4);
    expect(RATE_SCALE).toBe(10_000n);
    expect(RATE_MAX_SCALED).toBe(100_000_000_000n);
  });
});

describe('formatScaledRate', () => {
  it('renders four decimals', () => {
    expect(formatScaledRate(16233000n)).toBe('1623.3000');
    expect(formatScaledRate(1n)).toBe('0.0001');
    expect(formatScaledRate(10000n)).toBe('1.0000');
  });
});
