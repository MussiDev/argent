import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  MOVEMENT_AMOUNT_MAX_MINOR_UNITS,
  MOVEMENT_NOTE_MAX_LENGTH,
  RetryableError,
  createMovementRequestSchema,
  listMovementsQuerySchema,
  movementResponseSchema,
} from '../src';

const ACCOUNT_ID = '0b9d1f6e-5a3c-4c8e-9a43-2f1d7a6b8c90';
const CATEGORY_ID = '5d7c2b1a-9e84-4f3a-8b61-0c2d4e6f8a10';

const base = {
  type: 'expense',
  accountId: ACCOUNT_ID,
  categoryId: CATEGORY_ID,
  amount: '150050',
  occurredAt: '2026-10-02T15:30:00Z',
  rate: { source: 'automatic' },
};

function fieldsOf(input: unknown): string[] {
  const result = createMovementRequestSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join('.'));
}

describe('create movement request', () => {
  it('accepts an expense and an income with automatic and manual rates (AC-01, AC-04, AC-08)', () => {
    expect(createMovementRequestSchema.safeParse(base).success).toBe(true);
    const income = createMovementRequestSchema.parse({
      ...base,
      type: 'income',
      rate: { source: 'manual', value: '16233000' },
    });
    expect(income.type).toBe('income');
    expect(income.rate).toEqual({ source: 'manual', value: '16233000' });
  });

  it('accepts the amount bounds 1 and 10^15 and rejects 0, negatives, decimals and above (AC-02)', () => {
    expect(createMovementRequestSchema.safeParse({ ...base, amount: '1' }).success).toBe(true);
    expect(
      createMovementRequestSchema.safeParse({
        ...base,
        amount: MOVEMENT_AMOUNT_MAX_MINOR_UNITS.toString(),
      }).success,
    ).toBe(true);
    for (const amount of ['0', '-5', '12.5', '1000000000000001', '', 'abc', '007']) {
      expect(fieldsOf({ ...base, amount }), amount).toContain('amount');
    }
  });

  it('rejects a manual rate of 0 or below, non-numeric and above the maximum (AC-09)', () => {
    for (const value of ['0', '-1', 'abc', '1.5', '100000000001', '']) {
      expect(fieldsOf({ ...base, rate: { source: 'manual', value } }), value).toContain(
        'rate.value',
      );
    }
    expect(fieldsOf({ ...base, rate: { source: 'manual' } })).toContain('rate.value');
    expect(fieldsOf({ ...base, rate: { source: 'other' } }).length).toBeGreaterThan(0);
    expect(fieldsOf({ ...base, rate: undefined })).toContain('rate');
  });

  it('rejects malformed, non-UTC and impossible timestamps, and years outside 1970-2100', () => {
    for (const occurredAt of [
      'yesterday',
      '2026-10-02',
      '2026-10-02T15:30:00',
      '2026-10-02T15:30:00-03:00',
      '2026-02-30T00:00:00Z',
      '1969-12-31T23:59:59Z',
      '2101-01-01T00:00:00Z',
    ]) {
      expect(fieldsOf({ ...base, occurredAt }), occurredAt).toContain('occurredAt');
    }
    expect(
      createMovementRequestSchema.safeParse({ ...base, occurredAt: '1970-01-01T00:00:00Z' })
        .success,
    ).toBe(true);
    expect(
      createMovementRequestSchema.safeParse({ ...base, occurredAt: '2026-10-02T15:30:00.123Z' })
        .success,
    ).toBe(true);
  });

  it('trims the note, turns an empty one into absent and rejects 501 characters or controls', () => {
    expect(createMovementRequestSchema.parse({ ...base, note: '  lunch  ' }).note).toBe('lunch');
    expect(createMovementRequestSchema.parse({ ...base, note: '   ' }).note).toBeUndefined();
    expect(
      createMovementRequestSchema.safeParse({
        ...base,
        note: 'a'.repeat(MOVEMENT_NOTE_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(fieldsOf({ ...base, note: 'a'.repeat(MOVEMENT_NOTE_MAX_LENGTH + 1) })).toContain('note');
    expect(fieldsOf({ ...base, note: 'a\u0000b' })).toContain('note');
    expect(fieldsOf({ ...base, note: 'a‮b' })).toContain('note');
  });

  it('stores the NFC and NFD forms of the same note identically', () => {
    const nfc = 'café';
    const nfd = 'café';
    expect(nfc).not.toBe(nfd);
    const a = createMovementRequestSchema.parse({ ...base, note: nfc }).note;
    const b = createMovementRequestSchema.parse({ ...base, note: nfd }).note;
    expect(b).toBe(a);
    expect(a).toBe(nfc);
  });

  it('rejects bad ids and types and strips unknown keys', () => {
    expect(fieldsOf({ ...base, accountId: 'nope' })).toContain('accountId');
    expect(fieldsOf({ ...base, categoryId: 'nope' })).toContain('categoryId');
    expect(fieldsOf({ ...base, type: 'transfer' })).toContain('type');
    const parsed = createMovementRequestSchema.parse({ ...base, ownerId: 'x' });
    expect(parsed).not.toHaveProperty('ownerId');
  });

  it('never echoes the rejected value in the issues', () => {
    const result = createMovementRequestSchema.safeParse({ ...base, note: 'secret\u0000' });
    expect(JSON.stringify(result.error?.issues)).not.toContain('secret');
  });
});

describe('list movements query', () => {
  it('defaults to limit 50 and offset 0 and accepts 100 (AC-14)', () => {
    expect(listMovementsQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(listMovementsQuerySchema.parse({ limit: '100', offset: '10' })).toEqual({
      limit: 100,
      offset: 10,
    });
  });

  it('rejects 101, 0, a blank limit and a negative offset (AC-14)', () => {
    for (const query of [{ limit: '101' }, { limit: '0' }, { limit: '' }, { offset: '-1' }]) {
      expect(listMovementsQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
    expect(listMovementsQuerySchema.safeParse({ offset: ' ' }).success).toBe(false);
  });
});

describe('movement response', () => {
  const response = {
    id: ACCOUNT_ID,
    type: 'expense',
    accountId: ACCOUNT_ID,
    categoryId: CATEGORY_ID,
    amount: '150050',
    occurredAt: '2026-10-02T15:30:00.000Z',
    note: null,
    rate: '16233000',
    rateSource: 'automatic',
    rateType: 'blue',
    createdAt: '2026-10-02T15:31:00.000Z',
  };

  it('accepts an automatic and a manual movement', () => {
    expect(movementResponseSchema.safeParse(response).success).toBe(true);
    expect(
      movementResponseSchema.safeParse({ ...response, rateSource: 'manual', rateType: null })
        .success,
    ).toBe(true);
    expect(movementResponseSchema.safeParse({ ...response, rateSource: 'x' }).success).toBe(false);
  });
});

describe('new error codes and RetryableError', () => {
  it('lists the four new error codes (AC-15, AC-21, AC-26)', () => {
    for (const code of [
      'MOVEMENT_DATE_IN_FUTURE',
      'RATE_REQUIRED',
      'MOVEMENT_CATEGORY_KIND_MISMATCH',
      'CATEGORY_ARCHIVED',
    ]) {
      expect(ERROR_CODES as readonly string[]).toContain(code);
    }
  });

  it('carries a validated positive integer retryAfterSeconds', () => {
    const error = new RetryableError('RATE_LIMITED', 17);
    expect(error.retryAfterSeconds).toBe(17);
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.name).toBe('RetryableError');
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new RetryableError('RATE_LIMITED', bad), String(bad)).toThrow(RangeError);
    }
  });
});
