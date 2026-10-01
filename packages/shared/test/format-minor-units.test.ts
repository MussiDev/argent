import { describe, expect, it } from 'vitest';
import { formatMinorUnits } from '../src/money/format-minor-units';

describe('formatMinorUnits', () => {
  it('uses en-US separators for en and es-AR separators for es (AC-10)', () => {
    expect(formatMinorUnits(155730n, 'en')).toBe('1,557.30');
    expect(formatMinorUnits(155730n, 'es')).toBe('1.557,30');
  });

  it('pads fractions, handles zero and negatives (AC-10)', () => {
    expect(formatMinorUnits(5n, 'en')).toBe('0.05');
    expect(formatMinorUnits(0n, 'en')).toBe('0.00');
    expect(formatMinorUnits(-155730n, 'en')).toBe('-1,557.30');
    expect(formatMinorUnits(-5n, 'es')).toBe('-0,05');
  });

  it('keeps every digit above 2^53 (AC-10)', () => {
    expect(formatMinorUnits(9007199254740993n, 'en')).toBe('90,071,992,547,409.93');
    expect(formatMinorUnits(123456789012345678901n, 'es')).toBe('1.234.567.890.123.456.789,01');
  });
});
