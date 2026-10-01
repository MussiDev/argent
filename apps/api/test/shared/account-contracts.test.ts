import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_CURRENCIES,
  ACCOUNT_TYPES,
  MINOR_UNITS_MAX,
  MINOR_UNITS_MIN,
  OPENING_BALANCE_LIMIT_MINOR_UNITS,
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

  it('accepts a negative opening balance', () => {
    expect(
      createAccountRequestSchema.parse({ ...valid, openingBalance: '-150000' }).openingBalance,
    ).toBe('-150000');
  });

  it('accepts an opening balance of exactly plus and minus 10^15 (AC-19)', () => {
    expect(OPENING_BALANCE_LIMIT_MINOR_UNITS).toBe(10n ** 15n);
    expect(
      createAccountRequestSchema.parse({ ...valid, openingBalance: '1000000000000000' })
        .openingBalance,
    ).toBe('1000000000000000');
    expect(
      createAccountRequestSchema.parse({ ...valid, openingBalance: '-1000000000000000' })
        .openingBalance,
    ).toBe('-1000000000000000');
  });

  it.each(['1000000000000001', '-1000000000000001'])(
    'rejects opening balance %s beyond the 10^15 bound and names openingBalance (AC-18)',
    (openingBalance) => {
      const result = createAccountRequestSchema.safeParse({ ...valid, openingBalance });
      expect(result.success).toBe(false);
      expect(failedPaths(result)).toContain('openingBalance');
      expect(
        result.error?.issues.find((issue) => issue.path.join('.') === 'openingBalance')?.message,
      ).toBe('Opening balance must be within plus or minus 1000000000000000 minor units');
    },
  );

  it('rejects the int64 extremes as an opening balance', () => {
    for (const openingBalance of [MINOR_UNITS_MAX.toString(), MINOR_UNITS_MIN.toString()]) {
      const result = createAccountRequestSchema.safeParse({ ...valid, openingBalance });
      expect(result.success).toBe(false);
      expect(failedPaths(result)).toContain('openingBalance');
    }
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
    const result = createAccountRequestSchema.parse({ ...valid, name: '  Cafe\u0301  ' });
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

  const forbidden: [string, string][] = [
    ['zero-width space', 'Ca\u200Bsh'],
    ['right-to-left override', 'Ca\u202Esh'],
    ['NUL character', 'Ca\u0000sh'],
    ['soft hyphen', 'Ca\u00ADsh'],
    ['leading BOM', '\uFEFFCaja'],
    ['trailing newline', 'Caja\n'],
    ['leading tab', '\tCaja'],
    ['tab inside', 'Ca\tja'],
    ['leading zero-width space', '\u200BCaja'],
    ['trailing right-to-left override', 'Caja\u202E'],
  ];

  it.each(forbidden)('rejects a name with a %s for create and rename (AC-20)', (_label, name) => {
    expect(accountNameSchema.safeParse(name).success).toBe(false);
    const create = createAccountRequestSchema.safeParse({ ...valid, name });
    expect(create.success).toBe(false);
    expect(failedPaths(create)).toContain('name');
    const rename = renameAccountRequestSchema.safeParse({ name });
    expect(rename.success).toBe(false);
    expect(failedPaths(rename)).toContain('name');
  });

  it('still trims plain spaces at the edges', () => {
    expect(accountNameSchema.parse('  Caja  ')).toBe('Caja');
  });

  const emptyNames: [string, string][] = [
    ['only spaces', '     '],
    ['only zero-width characters', '\u200B\u200C\u200D\uFEFF'],
    ['spaces and zero-width characters', '  \u200B \u200D  '],
  ];

  it.each(emptyNames)('rejects a name of %s as empty (AC-21)', (_label, name) => {
    const result = accountNameSchema.safeParse(name);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('1 to 50');
    expect(failedPaths(createAccountRequestSchema.safeParse({ ...valid, name }))).toContain('name');
    expect(failedPaths(renameAccountRequestSchema.safeParse({ name }))).toContain('name');
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

  it('accepts a total of 9,300 times 10^15 and a balance beyond int64 (AC-22)', () => {
    const huge = (9_300n * 10n ** 15n).toString();
    const beyond = (MINOR_UNITS_MAX + 1n).toString();
    const body = {
      items: [{ ...account, balance: beyond }],
      totals: { ARS: huge, USD: `-${huge}` },
      total: 1,
      limit: 50,
      offset: 0,
    };
    expect(listAccountsResponseSchema.safeParse(body).success).toBe(true);
    expect(accountResponseSchema.safeParse({ ...account, balance: beyond }).success).toBe(true);
  });

  it('rejects a non-integer or 41-digit balance or total (AC-22)', () => {
    const body = {
      items: [account],
      totals: { ARS: '1', USD: '0' },
      total: 1,
      limit: 50,
      offset: 0,
    };
    for (const bad of ['1.5', 'abc', '', '9'.repeat(41)]) {
      expect(accountResponseSchema.safeParse({ ...account, balance: bad }).success).toBe(false);
      expect(
        listAccountsResponseSchema.safeParse({ ...body, totals: { ARS: bad, USD: '0' } }).success,
      ).toBe(false);
    }
  });

  it('keeps the int64 validator on openingBalance of the response', () => {
    const beyond = (MINOR_UNITS_MAX + 1n).toString();
    expect(accountResponseSchema.safeParse({ ...account, openingBalance: beyond }).success).toBe(
      false,
    );
  });
});
