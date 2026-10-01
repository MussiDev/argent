import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_CURRENCIES,
  ACCOUNT_TYPES,
  MINOR_UNITS_MIN,
  accountIdParamsSchema,
  accountNameSchema,
  accountResponseSchema,
  createAccountRequestSchema,
  listAccountsQuerySchema,
  listAccountsResponseSchema,
  renameAccountRequestSchema,
} from '@argent/shared';

const valid = { name: 'Cash', type: 'cash', currency: 'ARS' } as const;
const UUID = '0b0f6f0e-8c1d-4c8e-9a53-3d1f2a9c5b11';

function failedPaths(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}): string[] {
  return (result.error?.issues ?? []).map((i) => i.path.map(String).join('.'));
}

describe('createAccountRequestSchema', () => {
  it('accepts a valid body', () => {
    expect(createAccountRequestSchema.safeParse({ ...valid, openingBalance: '1000' }).success).toBe(
      true,
    );
  });

  it.each(['name', 'type', 'currency'] as const)('rejects a missing %s and names it', (f) => {
    const body: Record<string, unknown> = Object.fromEntries(
      Object.entries(valid).filter(([key]) => key !== f),
    );
    const result = createAccountRequestSchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(failedPaths(result)).toContain(f);
  });

  it('offers exactly the five types', () => {
    expect([...ACCOUNT_TYPES]).toEqual([
      'cash',
      'bank_account',
      'digital_wallet',
      'credit_card',
      'savings',
    ]);
    for (const type of ACCOUNT_TYPES) {
      expect(createAccountRequestSchema.safeParse({ ...valid, type }).success).toBe(true);
    }
    expect(createAccountRequestSchema.safeParse({ ...valid, type: 'crypto' }).success).toBe(false);
  });

  it('fails with an invalid currency such as EUR and offers only ARS and USD', () => {
    expect([...ACCOUNT_CURRENCIES]).toEqual(['ARS', 'USD']);
    const result = createAccountRequestSchema.safeParse({ ...valid, currency: 'EUR' });
    expect(result.success).toBe(false);
    expect(failedPaths(result)).toContain('currency');
  });

  it.each(['1.5', '1e3', '', 'abc', '0x10'])('rejects opening balance %j', (openingBalance) => {
    const result = createAccountRequestSchema.safeParse({ ...valid, openingBalance });
    expect(result.success).toBe(false);
    expect(failedPaths(result)).toContain('openingBalance');
  });

  it('rejects a numeric (non-string) opening balance', () => {
    expect(createAccountRequestSchema.safeParse({ ...valid, openingBalance: 100 }).success).toBe(
      false,
    );
  });

  it('defaults an omitted opening balance to "0"', () => {
    expect(createAccountRequestSchema.parse(valid).openingBalance).toBe('0');
  });

  it('accepts a negative opening balance and the int64 minimum', () => {
    expect(
      createAccountRequestSchema.parse({ ...valid, openingBalance: '-150000' }).openingBalance,
    ).toBe('-150000');
    expect(
      createAccountRequestSchema.parse({ ...valid, openingBalance: MINOR_UNITS_MIN.toString() })
        .openingBalance,
    ).toBe('-9223372036854775808');
  });

  it('rejects values outside int64', () => {
    expect(
      createAccountRequestSchema.safeParse({ ...valid, openingBalance: '9223372036854775808' })
        .success,
    ).toBe(false);
    expect(
      createAccountRequestSchema.safeParse({ ...valid, openingBalance: '-9223372036854775809' })
        .success,
    ).toBe(false);
  });

  it('trims and NFC-normalizes the name', () => {
    const result = createAccountRequestSchema.parse({ ...valid, name: '  Café  ' });
    expect(result.name).toBe('Café');
  });
});

describe('accountNameSchema', () => {
  it('accepts 50 code points and fails on 51', () => {
    expect(accountNameSchema.safeParse('a'.repeat(50)).success).toBe(true);
    expect(accountNameSchema.safeParse('a'.repeat(51)).success).toBe(false);
  });

  it('counts an emoji as one code point', () => {
    expect(accountNameSchema.safeParse('\u{1F4B0}'.repeat(50)).success).toBe(true);
    expect(accountNameSchema.safeParse('\u{1F4B0}'.repeat(51)).success).toBe(false);
  });

  it('rejects empty and whitespace-only names and non-strings', () => {
    expect(accountNameSchema.safeParse('').success).toBe(false);
    expect(accountNameSchema.safeParse('   ').success).toBe(false);
    expect(accountNameSchema.safeParse(5).success).toBe(false);
  });
});

describe('renameAccountRequestSchema', () => {
  it('accepts a name only', () => {
    expect(renameAccountRequestSchema.parse({ name: ' Savings ' })).toEqual({ name: 'Savings' });
  });

  it('fails when currency or type is present', () => {
    const withCurrency = renameAccountRequestSchema.safeParse({ name: 'X', currency: 'USD' });
    expect(withCurrency.success).toBe(false);
    expect(failedPaths(withCurrency)).toContain('currency');
    const withType = renameAccountRequestSchema.safeParse({ name: 'X', type: 'cash' });
    expect(withType.success).toBe(false);
    expect(failedPaths(withType)).toContain('type');
  });

  it('rejects a missing name', () => {
    expect(renameAccountRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('accountIdParamsSchema', () => {
  it('requires a UUID', () => {
    expect(accountIdParamsSchema.safeParse({ id: UUID }).success).toBe(true);
    expect(accountIdParamsSchema.safeParse({ id: 'nope' }).success).toBe(false);
  });
});

describe('listAccountsQuerySchema', () => {
  it('defaults archived=false, limit=50, offset=0', () => {
    expect(listAccountsQuerySchema.parse({})).toEqual({ archived: false, limit: 50, offset: 0 });
  });

  it('accepts limit 100 and fails on 101, 0 and non-numeric', () => {
    expect(listAccountsQuerySchema.parse({ limit: '100' }).limit).toBe(100);
    expect(listAccountsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(listAccountsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(listAccountsQuerySchema.safeParse({ limit: 'abc' }).success).toBe(false);
  });

  it('rejects a negative offset and accepts a positive one', () => {
    expect(listAccountsQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
    expect(listAccountsQuerySchema.parse({ offset: '20' }).offset).toBe(20);
  });

  it('rejects empty or whitespace-only limit and offset', () => {
    expect(listAccountsQuerySchema.safeParse({ limit: '' }).success).toBe(false);
    expect(listAccountsQuerySchema.safeParse({ offset: '' }).success).toBe(false);
    expect(listAccountsQuerySchema.safeParse({ offset: ' ' }).success).toBe(false);
    expect(listAccountsQuerySchema.safeParse({ limit: '  ' }).success).toBe(false);
  });

  it('transforms archived to a boolean and rejects other values', () => {
    expect(listAccountsQuerySchema.parse({ archived: 'true' }).archived).toBe(true);
    expect(listAccountsQuerySchema.parse({ archived: 'false' }).archived).toBe(false);
    expect(listAccountsQuerySchema.safeParse({ archived: 'yes' }).success).toBe(false);
  });
});

describe('response schemas', () => {
  const account = {
    id: UUID,
    name: 'Cash',
    type: 'cash',
    currency: 'ARS',
    openingBalance: '0',
    balance: '-150000',
    archived: false,
    archivedAt: null,
    createdAt: '2026-10-01T12:00:00.000Z',
  };

  it('accepts an account with decimal-string amounts', () => {
    expect(accountResponseSchema.safeParse(account).success).toBe(true);
    expect(
      accountResponseSchema.safeParse({
        ...account,
        archived: true,
        archivedAt: '2026-10-02T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects JSON-number amounts', () => {
    expect(accountResponseSchema.safeParse({ ...account, balance: 5 }).success).toBe(false);
  });

  it('accepts a list response and requires both currency totals', () => {
    const body = {
      items: [account],
      totals: { ARS: '-150000', USD: '0' },
      total: 1,
      limit: 50,
      offset: 0,
    };
    expect(listAccountsResponseSchema.safeParse(body).success).toBe(true);
    expect(listAccountsResponseSchema.safeParse({ ...body, totals: { ARS: '1' } }).success).toBe(
      false,
    );
  });
});
