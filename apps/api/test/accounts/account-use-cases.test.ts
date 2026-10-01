import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MINOR_UNITS_MAX, sumMinorUnits } from '@argent/shared';
import {
  AccountHasMovements,
  AccountNameTaken,
  CreateAccount,
  DeleteAccount,
  GetAccount,
  ListAccounts,
  RenameAccount,
  SetAccountArchived,
} from '../../src/accounts';
import { balanceOf } from '../../src/accounts/domain/account';
import { ResourceNotFound } from '../../src/shared/access';
import {
  FakeAccountMovements,
  InMemoryAccountRepository,
  readScopeFor,
  writeScopeFor,
} from './fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

let accounts: InMemoryAccountRepository;
let movements: FakeAccountMovements;
let createAccount: CreateAccount;
let getAccount: GetAccount;
let listAccounts: ListAccounts;
let renameAccount: RenameAccount;
let setArchived: SetAccountArchived;
let deleteAccount: DeleteAccount;

const defaultList = { archived: false, limit: 50, offset: 0 };

beforeEach(() => {
  accounts = new InMemoryAccountRepository();
  movements = new FakeAccountMovements();
  const deps = { accounts, movements };
  createAccount = new CreateAccount(deps);
  getAccount = new GetAccount(deps);
  listAccounts = new ListAccounts(deps);
  renameAccount = new RenameAccount(deps);
  setArchived = new SetAccountArchived(deps);
  deleteAccount = new DeleteAccount(deps);
});

async function create(
  userId: string,
  name: string,
  openingBalance = 0n,
  currency: 'ARS' | 'USD' = 'ARS',
) {
  return createAccount.execute(await writeScopeFor(userId), {
    name,
    type: 'bank_account',
    currency,
    openingBalance,
  });
}

describe('balanceOf', () => {
  it('adds the movement sum to the opening balance, exactly and within range', () => {
    expect(balanceOf(100n, -250n)).toBe(-150n);
    expect(() => balanceOf(MINOR_UNITS_MAX, 1n)).toThrow(RangeError);
  });
});

describe('create', () => {
  it('returns the account with balance equal to the opening balance (AC-01)', async () => {
    const account = await create(ALICE, 'Cash', 150000n);
    expect(account).toMatchObject({
      name: 'Cash',
      type: 'bank_account',
      currency: 'ARS',
      openingBalance: 150000n,
      balance: 150000n,
      archivedAt: null,
    });
    expect(typeof account.balance).toBe('bigint');
  });

  it('stores 0 when the parsed input carries the default, and keeps a negative opening balance (AC-16, AC-17)', async () => {
    const zero = await create(ALICE, 'Zero');
    expect(zero.openingBalance).toBe(0n);
    expect(zero.balance).toBe(0n);

    const negative = await create(ALICE, 'Overdraft', -5000n);
    expect(negative.openingBalance).toBe(-5000n);
    expect(negative.balance).toBe(-5000n);
  });

  it('rejects a case-insensitive duplicate name with AccountNameTaken (AC-13)', async () => {
    await create(ALICE, 'Savings');
    await expect(create(ALICE, 'sAVINGS')).rejects.toBeInstanceOf(AccountNameTaken);
    await expect(create(ALICE, 'sAVINGS')).rejects.toMatchObject({ code: 'ACCOUNT_NAME_TAKEN' });
    // Another user may reuse the name.
    await expect(create(BOB, 'Savings')).resolves.toMatchObject({ name: 'Savings' });
  });
});

describe('rename', () => {
  it('persists and is returned by get and list (AC-06)', async () => {
    const account = await create(ALICE, 'Old');
    const renamed = await renameAccount.execute(await writeScopeFor(ALICE), account.id, 'New');
    expect(renamed.name).toBe('New');

    const scope = await readScopeFor(ALICE);
    expect((await getAccount.execute(scope, account.id)).name).toBe('New');
    const list = await listAccounts.execute(scope, defaultList);
    expect(list.items.map((item) => item.name)).toEqual(['New']);
  });

  it('allows a name that only another user uses (AC-13 is per owner)', async () => {
    await create(BOB, 'Shared');
    const mine = await create(ALICE, 'Mine');
    await expect(
      renameAccount.execute(await writeScopeFor(ALICE), mine.id, 'Shared'),
    ).resolves.toMatchObject({ name: 'Shared' });
  });

  it('rejects a case-insensitive duplicate name (AC-13) but allows changing only the case of its own name', async () => {
    await create(ALICE, 'Savings');
    const other = await create(ALICE, 'Other');
    const scope = await writeScopeFor(ALICE);
    await expect(renameAccount.execute(scope, other.id, 'SAVINGS')).rejects.toBeInstanceOf(
      AccountNameTaken,
    );
    await expect(renameAccount.execute(scope, other.id, 'OTHER')).resolves.toMatchObject({
      name: 'OTHER',
    });
  });
});

describe('archive and unarchive', () => {
  it('hides the account from the default list, keeps it readable and deletes nothing; unarchive restores it (AC-07, AC-08)', async () => {
    const account = await create(ALICE, 'Wallet', 700n);
    const write = await writeScopeFor(ALICE);
    const read = await readScopeFor(ALICE);

    const archived = await setArchived.execute(write, account.id, true);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect((await listAccounts.execute(read, defaultList)).items).toEqual([]);
    expect(accounts.rows.size).toBe(1);
    expect(await getAccount.execute(read, account.id)).toMatchObject({
      id: account.id,
      balance: 700n,
    });

    const archivedList = await listAccounts.execute(read, { ...defaultList, archived: true });
    expect(archivedList.items.map((item) => [item.id, item.balance])).toEqual([[account.id, 700n]]);

    const restored = await setArchived.execute(write, account.id, false);
    expect(restored.archivedAt).toBeNull();
    expect((await listAccounts.execute(read, defaultList)).items).toHaveLength(1);
  });

  it('is idempotent in both directions', async () => {
    const account = await create(ALICE, 'Wallet');
    const write = await writeScopeFor(ALICE);
    const first = await setArchived.execute(write, account.id, true);
    const second = await setArchived.execute(write, account.id, true);
    expect(second.archivedAt).toEqual(first.archivedAt);
    await setArchived.execute(write, account.id, false);
    const again = await setArchived.execute(write, account.id, false);
    expect(again.archivedAt).toBeNull();
  });
});

describe('delete', () => {
  it('removes an account with no movements (AC-09)', async () => {
    const account = await create(ALICE, 'Gone');
    await deleteAccount.execute(await writeScopeFor(ALICE), account.id);
    expect(accounts.rows.has(account.id)).toBe(false);
    await expect(getAccount.execute(await readScopeFor(ALICE), account.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });

  it('fails with AccountHasMovements when the port reports movements, and the row stays (AC-10)', async () => {
    const account = await create(ALICE, 'Used');
    movements.used.add(account.id);
    const error = await deleteAccount
      .execute(await writeScopeFor(ALICE), account.id)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccountHasMovements);
    expect(error).toMatchObject({ code: 'ACCOUNT_HAS_MOVEMENTS' });
    expect(accounts.rows.has(account.id)).toBe(true);
  });

  it("answers ResourceNotFound for another user's used account without consulting the movements port", async () => {
    const theirs = await create(BOB, 'TheirsUsed');
    movements.used.add(theirs.id);
    const spy = vi.spyOn(movements, 'hasMovements');
    const error = await deleteAccount
      .execute(await writeScopeFor(ALICE), theirs.id)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResourceNotFound);
    expect(error).not.toBeInstanceOf(AccountHasMovements);
    expect(spy).not.toHaveBeenCalled();
    expect(accounts.rows.has(theirs.id)).toBe(true);
  });

  it('lets a repository foreign-key violation surface as AccountHasMovements', async () => {
    const account = await create(ALICE, 'Racy');
    accounts.deleteError = new AccountHasMovements();
    await expect(
      deleteAccount.execute(await writeScopeFor(ALICE), account.id),
    ).rejects.toBeInstanceOf(AccountHasMovements);
  });
});

describe('balance (AC-11)', () => {
  it('equals the opening balance plus the port sum, including a negative sum', async () => {
    const plus = await create(ALICE, 'Plus', 1000n);
    const minus = await create(ALICE, 'Minus', 1000n);
    movements.sums.set(plus.id, 500n);
    movements.sums.set(minus.id, -2500n);
    const read = await readScopeFor(ALICE);

    expect((await getAccount.execute(read, plus.id)).balance).toBe(1500n);
    expect((await getAccount.execute(read, minus.id)).balance).toBe(-1500n);
    const list = await listAccounts.execute(read, defaultList);
    expect(list.items.map((item) => item.balance)).toEqual([1500n, -1500n]);
  });

  it('is also returned by rename and archive responses', async () => {
    const account = await create(ALICE, 'A', 100n);
    movements.sums.set(account.id, 23n);
    const write = await writeScopeFor(ALICE);
    expect((await renameAccount.execute(write, account.id, 'B')).balance).toBe(123n);
    expect((await setArchived.execute(write, account.id, true)).balance).toBe(123n);
  });
});

describe('list totals (AC-12)', () => {
  it('sums active balances per currency across pages, ignoring archived accounts', async () => {
    const a = await create(ALICE, 'A', 100n);
    const b = await create(ALICE, 'B', 200n);
    await create(ALICE, 'C', 300n);
    const usd = await create(ALICE, 'D', 50n, 'USD');
    const archived = await create(ALICE, 'E', 9999n);
    await setArchived.execute(await writeScopeFor(ALICE), archived.id, true);
    movements.sums.set(a.id, -40n);
    movements.sums.set(b.id, 1n);
    movements.sums.set(usd.id, 25n);
    movements.sums.set(archived.id, 1n);
    const read = await readScopeFor(ALICE);

    const page1 = await listAccounts.execute(read, { archived: false, limit: 2, offset: 0 });
    const page2 = await listAccounts.execute(read, { archived: false, limit: 2, offset: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(2);
    expect(page1.total).toBe(4);
    for (const page of [page1, page2]) {
      expect(page.totals).toEqual({ ARS: sumMinorUnits([60n, 201n, 300n]), USD: 75n });
    }
  });

  it('reports zero for every currency when there are no active accounts', async () => {
    const list = await listAccounts.execute(await readScopeFor(ALICE), defaultList);
    expect(list).toEqual({ items: [], total: 0, totals: { ARS: 0n, USD: 0n } });
  });

  it('keeps totals on the active accounts when listing archived ones', async () => {
    await create(ALICE, 'Active', 10n);
    const old = await create(ALICE, 'Old', 99n);
    await setArchived.execute(await writeScopeFor(ALICE), old.id, true);
    const list = await listAccounts.execute(await readScopeFor(ALICE), {
      ...defaultList,
      archived: true,
    });
    expect(list.items.map((item) => item.balance)).toEqual([99n]);
    expect(list.totals).toEqual({ ARS: 10n, USD: 0n });
  });

  it('rejects a limit or offset outside the documented range', async () => {
    const read = await readScopeFor(ALICE);
    for (const options of [
      { archived: false, limit: 0, offset: 0 },
      { archived: false, limit: 101, offset: 0 },
      { archived: false, limit: 10, offset: -1 },
      { archived: false, limit: 1.5, offset: 0 },
    ]) {
      await expect(listAccounts.execute(read, options)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
  });
});

describe('isolation', () => {
  it('list returns only the caller accounts (AC-15)', async () => {
    await create(ALICE, 'Mine', 5n);
    const theirs = await create(BOB, 'Theirs', 7n);
    const list = await listAccounts.execute(await readScopeFor(ALICE), defaultList);
    expect(list.items.map((item) => item.name)).toEqual(['Mine']);
    expect(list.totals.ARS).toBe(5n);
    // The port never sees an id the scoped repository did not return.
    expect(movements.sumCalls.flat()).not.toContain(theirs.id);
  });

  it("get, rename, archive, unarchive and delete of another user's account raise ResourceNotFound and change nothing (AC-14)", async () => {
    const theirs = await create(BOB, 'Theirs', 7n);
    const write = await writeScopeFor(ALICE);
    const read = await readScopeFor(ALICE);

    const attempts = [
      () => getAccount.execute(read, theirs.id),
      () => renameAccount.execute(write, theirs.id, 'Hijacked'),
      () => setArchived.execute(write, theirs.id, true),
      () => setArchived.execute(write, theirs.id, false),
      () => deleteAccount.execute(write, theirs.id),
      () => getAccount.execute(read, '33333333-3333-4333-8333-333333333333'),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toBeInstanceOf(ResourceNotFound);
    }
    expect(accounts.rows.get(theirs.id)?.account).toMatchObject({
      name: 'Theirs',
      archivedAt: null,
      openingBalance: 7n,
    });
  });
});

describe('failing movements port', () => {
  it('makes list fail with the same error instead of returning balances', async () => {
    await create(ALICE, 'A', 1n);
    const failure = new Error('movements unavailable');
    movements.failure = failure;
    await expect(listAccounts.execute(await readScopeFor(ALICE), defaultList)).rejects.toBe(
      failure,
    );
  });

  it('makes delete fail instead of assuming there are no movements', async () => {
    const account = await create(ALICE, 'A');
    const failure = new Error('movements unavailable');
    movements.failure = failure;
    await expect(deleteAccount.execute(await writeScopeFor(ALICE), account.id)).rejects.toBe(
      failure,
    );
    expect(accounts.rows.has(account.id)).toBe(true);
  });
});

describe('chunking (NFR-02)', () => {
  it('calls the port in chunks of at most 500 ids for 1,200 active accounts', async () => {
    for (let i = 0; i < 1200; i += 1) accounts.seed(ALICE, { name: `Account ${i}` });
    const list = await listAccounts.execute(await readScopeFor(ALICE), {
      archived: false,
      limit: 100,
      offset: 0,
    });
    expect(list.items).toHaveLength(100);
    expect(movements.sumCalls.map((ids) => ids.length)).toEqual([500, 500, 200]);
    const allIds = movements.sumCalls.flat();
    expect(new Set(allIds).size).toBe(1200);
  });

  it('includes archived page ids in the same call set without duplicating active ones', async () => {
    accounts.seed(ALICE, { name: 'Active' });
    accounts.seed(ALICE, { name: 'Archived', archived: true });
    await listAccounts.execute(await readScopeFor(ALICE), { ...defaultList, archived: true });
    expect(movements.sumCalls).toHaveLength(1);
    expect(movements.sumCalls[0]).toHaveLength(2);
  });
});
