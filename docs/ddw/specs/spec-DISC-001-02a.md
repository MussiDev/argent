# Spec DISC-001-02a: Accounts

| Field | Value |
|-------|-------|
| Ticket | DISC-001-02a |
| PRD | docs/ddw/prd/prd-DISC-001-02a.md |
| Tier | FEATURE |
| Date | 2026-10-01 |
| Spec loops | 4 |
| Loops since last human decision | 0 |

## Summary
Adds the `accounts` module to the API, the shared money helpers and account contracts, and the web
screens to create, rename, archive, unarchive, delete and list accounts with balances and
per-currency totals. An account belongs to one user, has one currency (ARS or USD) and one type,
and both are immutable (rejected by the request validation and, as defence in depth, by a database
trigger). Amounts are `bigint` minor units in PostgreSQL and in TypeScript and travel as decimal
strings in JSON; every sum goes through helpers in `packages/shared`. Ownership uses the existing
`AccessPolicy` / `AccessScope` / `scopedTo` template, so another user's account answers 404.
Balances are computed on read: `balance = openingBalance + sum of movements`, where the movement
sum and the "account has movements" check sit behind an application port (`AccountMovements`) in the
accounts module (human decision, 2026-10-01). In this ticket the only production adapter returns
`0` / `false`, because no movements exist before PRD 03; PRD 03 supplies the real adapter without
touching accounts code, and no movements table is created here.

## Decisions recorded in this spec
- **Q2 (resolved by the human, 2026-10-01):** the port above. AC-10 is tested at the use-case level
  with a fake port that reports movements, and as a Postgres foreign-key backstop (error 23503)
  with a test-only referencing table. Its end-to-end test through a real movement is deferred to
  PRD 03.
- **Balance strategy (PRD risk "balance computed on every read"):** compute on read, with one
  batched port call per request for all the account ids involved; no running balance is stored.
- **Pagination:** `limit` (1 to 100, default 50) and `offset`; the totals always cover every active
  account, not only the page.
- **Money in JSON:** integer minor units as decimal strings (`"-150000"`), never JSON numbers.
- **Migration number:** `0006_accounts` after the rebase onto main (DISC-001-01c merged
  `0005_two_factor`). It stays provisional: DISC-001-01d and the 07a ticket may also claim 0006;
  whichever merges later renumbers its files
  (SQL, rollback script, `meta/_journal.json` entry and snapshot, regenerated with
  `pnpm --filter @argent/api db:generate`) and the migration-count test constants.
- **Layering and imports:** domain and application of `accounts` import `AccessScope` and
  `ResourceNotFound` only from the `shared/access` barrel, never from `shared/access/infrastructure`
  (`scopedTo` is used only by the repository adapter). Lint rules per `eslint.config.mjs`: domain
  bans I/O libraries and infrastructure; application bans infrastructure and test imports. The
  accounts schema imports `users` from `identity/infrastructure/db/schema` for the foreign key
  (infrastructure to infrastructure, the only way drizzle-kit can resolve the reference); the
  identity barrel is not changed.
- **One use case per file**, like the `identity` module; the repository's `create` takes an
  `AccessScope<'write'>` (the owner is the scope's user), so no repository method accepts a raw
  owner id.
- **Port invariant:** `AccountMovements` is unscoped by design and safe only because the module
  passes it ids that the scoped repository returned; the port documents this, and PRD 03's adapter
  must key every result by the ids it was given and must not read other accounts' rows.
- **Unbounded active list:** totals load every active account (id, currency, opening balance); the
  movements port is called in chunks of at most 500 ids. Fine at personal scale; PRD 03 re-runs the
  performance test against its real adapter.
- **`updated_at`:** set explicitly by the repository on rename, archive and unarchive (no trigger).
- **Native select:** Block 7 uses a native `<select>` styled with theme tokens. A Radix select would
  add a runtime dependency (none is installed) for a five-option field; the native control gives the
  platform picker on phones, which suits a mobile-first PWA, and keeps `pnpm audit` unchanged.
  Revisit if another feature introduces Radix select.
- **Navigation:** the accounts screens are reached from a link on the home page; the authenticated
  shell header is not touched in this ticket to avoid conflicts with sibling tickets.

## Deferred to PRD 03 (explicit, and not silent gaps)
- AC-10 end to end with a real movement (the use case, the port and the database backstop are
  tested here).
- The "keeps its movements visible in history" half of AC-07 (history belongs to PRD 03). Here the
  test asserts that archiving deletes nothing and that the archived account stays readable by id.
- The movement part of AC-11 beyond the port: the balance formula is tested with a fake port.
- NFR-01 and NFR-02 against the real movements table: here they are tested with exact bigint
  summation of 100,000 amounts and with a test-only movements table of 100,000 rows behind a test
  adapter. PRD 03 re-runs the same perf test against its real adapter.
- The real adapter must add a foreign key from movements to accounts with `ON DELETE RESTRICT`;
  the delete use case already maps that violation to `ACCOUNT_HAS_MOVEMENTS`.

## Human decisions taken during PLAN (settled; do not re-raise in reviews)
- **Q5, opening balance sign:** the opening balance may be negative, including zero and
  negatives (FR-01, AC-17); its magnitude is bounded by Q8.
- **Q6, opening balance optional:** the opening balance is not required; when omitted the API
  stores `0` and the web form pre-fills `0` (FR-01, AC-16). This amended the PRD through the PLAN to
  DEFINE corrective loop (PRD loops 2).
- **Q7, no cap on accounts per user and no extra write-rate limit:** the human decided to keep it as
  built. Cost is bounded by pagination, indexes, aggregate queries and the 500-id chunking. The
  threat model records it as accepted risk R-15.
- **Q8, opening balance bound (L-1, decided after VERIFY, 2026-10-01):** the absolute value of the
  opening balance is at most 10^13 major units, which is 10^15 minor units; a value outside the bound
  is a 400 validation error naming the field, never a 500 (FR-13, AC-18, AC-19). Balances and totals
  are derived values, computed with arbitrary-precision `bigint` and serialized as unbounded decimal
  strings, so no sum can fail or overflow (NFR-06, AC-22). Proof: a stored opening balance is at most
  10^15 minor units in absolute value and a movement sum is a `bigint`, so a total over N accounts is
  at most N times 10^15 plus the movement sums; JavaScript `bigint` has no upper limit, the response
  schema accepts any integer string of up to 40 digits (a total of 10^40 minor units would need 10^25
  accounts), and nothing derived is ever written back to a `bigint` column. Only the stored opening
  balance keeps the signed 64-bit type and a database CHECK.
- **Q9, names reject control and format characters (I-2, decided after VERIFY, 2026-10-01):** an
  account name containing a Unicode Cc or Cf character (control, zero-width, bidirectional
  override, soft hyphen, byte order mark) is a 400 validation error naming `body.name`; a name that
  is empty once whitespace is trimmed is an empty name; the web form tells "name required" (nothing
  visible) from "invalid characters" (visible text plus a Cc or Cf character) (FR-14, AC-20,
  AC-21).
- Q3 (language for the default categories) and Q4 (categories module layout) concern 02b only.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 3, Block 4, Block 5, Block 6, Block 7 |
| FR-02 | Block 1, Block 4, Block 7 |
| FR-03 | Block 1, Block 4, Block 5 |
| FR-04 | Block 1, Block 3, Block 4, Block 5 |
| FR-05 | Block 1, Block 3, Block 5, Block 6, Block 7 |
| FR-06 | Block 3, Block 5, Block 6, Block 7 |
| FR-07 | Block 3, Block 5, Block 6, Block 7 |
| FR-08 | Block 2, Block 3, Block 4, Block 5, Block 6, Block 7 |
| FR-09 | Block 3, Block 5, Block 6, Block 7 |
| FR-10 | Block 3, Block 5, Block 6, Block 7, Block 10 |
| FR-11 | Block 2, Block 3, Block 4, Block 5 |
| FR-12 | Block 3, Block 4, Block 5 |
| FR-13 | Block 9, Block 10, Block 11 |
| FR-14 | Block 9, Block 10, Block 11 |
| NFR-01 | Strategy: bigint minor units in a `bigint` column, decimal strings in JSON, all sums through the shared helpers (Block 1); a unit test sums 100,000 amounts and compares to the exact expected total (Block 1) |
| NFR-02 | Strategy: balances computed on read with one batched port call and aggregate queries (Block 3); the list query uses the owner index (Block 4); a performance test with a test-only 100,000-row movements table asserts p95 under 300 ms (Block 8) |
| NFR-03 | Strategy: the list query schema caps `limit` at 100 and rejects larger values with 400 (Block 1, Block 5) |
| NFR-04 | Strategy: every repository method requires an `AccessScope` and filters with `scopedTo` in the same statement (Block 4); the owner column is `NOT NULL` with a foreign key (Block 4) |
| NFR-06 | Strategy: balances and totals use exact `bigint` arithmetic (`addExact`, `sumExact`) and unbounded integer-string response schemas, so no sum can throw or overflow; the proof is in Q8 and a test sums 100,000 amounts of 10^15 and lists 9,300 accounts at 10^15 (Block 9, Block 10) |
| NFR-05 | Strategy: name validation counts code points, trims and normalizes (Block 1, Block 3), mirrored by a `CHECK` on `char_length` (Block 4) |

## Dependencies between blocks
Execution order: Block 1 → Block 2 → Block 3 → Block 4 → Block 5 → Block 6 → Block 7 → Block 8.
- Block 2 needs the error code list kept in Block 1's package (it edits the same package).
- Block 3 needs Block 1 (money helpers, contracts) and Block 2 (the two domain error codes).
- Block 4 implements the ports defined in Block 3.
- Block 5 composes Blocks 3 and 4 and the existing `requireSession`, `requireVerifiedEmail`,
  `validate` and `AccessPolicy`.
- Block 6 calls the contract fixed in Block 5; Block 7 uses Block 6.
- Block 8 runs against everything and needs all other blocks.
- Block 9 (added after VERIFY) amends Block 1's shared package and needs nothing else; Block 10 needs
  Block 9 and amends Blocks 3, 4 and 5; Block 11 needs Block 9 and amends Block 7 and the Block 8
  end-to-end spec. Order: Block 9 → Block 10 → Block 11.

## Block 1 — Money helpers and account contracts (packages/shared)

**Files**
- `packages/shared/src/money.ts` (new) — int64 minor-unit helpers and locale formatting/parsing.
- `packages/shared/src/accounts/account.ts` (new) — shared validation schemas and types for accounts.
- `packages/shared/src/index.ts` (modified) — exports both new modules.
- `apps/api/test/shared/money.test.ts` (new) — unit tests for the helpers.
- `apps/api/test/shared/account-contracts.test.ts` (new) — unit tests for the contracts.

**Logic**
`money.ts` (no Node globals; `Intl` only):
- `MINOR_UNITS_MIN` / `MINOR_UNITS_MAX` as `bigint` (signed 64-bit).
- `minorUnitsStringSchema`: a decimal integer string (`-?(0|[1-9]\d*)`) inside the int64 range.
- `parseMinorUnits(text): bigint`, `formatMinorUnitsString(value): string`.
- `addMinorUnits(a, b)` and `sumMinorUnits(values)`: bigint arithmetic that throws a `RangeError`
  when a result leaves the int64 range.
- `formatMoney(value, currency, locale)`: builds the exact decimal string from the bigint
  (`value / 100n` and `value % 100n`) and passes that string to `Intl.NumberFormat`, so no float is
  ever created.
- `parseAmountInput(text, locale)`: reads the locale's group and decimal separators with
  `Intl.NumberFormat(locale).formatToParts`, accepts an optional leading minus, group separators and
  up to two decimals, and returns `bigint` minor units or `null` for anything else.

`account.ts`:
- `ACCOUNT_TYPES = ['cash', 'bank_account', 'digital_wallet', 'credit_card', 'savings']` and
  `ACCOUNT_CURRENCIES = ['ARS', 'USD']`, each with its inferred type.
- `accountNameSchema`: trims, normalizes to NFC and requires 1 to 50 code points (NFR-05).
- `createAccountRequestSchema`: `name`, `type`, `currency` (required) and `openingBalance` (optional; absent becomes the string `"0"`, negatives accepted).
- `renameAccountRequestSchema`: `name`, plus `type` and `currency` declared as `z.never().optional()`
  so that sending either one is a validation failure instead of being silently stripped (FR-04).
- `accountIdParamsSchema` (`id` as UUID), `listAccountsQuerySchema` (`archived` as `z.enum(['true', 'false'])` defaulting to `'false'` and transformed to a boolean, `limit` 1 to 100 defaulting to 50, `offset` from 0).
- `accountResponseSchema` (`id`, `name`, `type`, `currency`, `openingBalance`, `balance`, `archived`,
  `archivedAt`, `createdAt`) and `listAccountsResponseSchema` (`items`, `totals` with `ARS` and
  `USD`, `total`, `limit`, `offset`).

**Input validation**
- Names: string, trimmed, NFC, 1 to 50 code points (Block 9 adds the rejection of Unicode Cc and Cf characters). Type: one of the five values. Currency: `ARS`
  or `USD` only. Amounts: decimal integer strings inside int64 (negatives allowed; the opening balance may be omitted; Block 9 narrows the opening balance to plus or minus 10^15 minor units). `limit` at most 100. Unknown keys are
  stripped by the shared `validate` middleware, except `type` and `currency` on rename, which fail.

**Error handling**
- A name that is empty or longer than 50 code points fails validation (`VALIDATION_FAILED` with the field path).
- A currency other than ARS or USD fails validation.
- A `type` or `currency` sent on rename fails validation.
- An opening balance that is present but not an integer string, or that leaves the int64 range, fails validation.
- `limit` above 100 or below 1 fails validation.
- A sum that leaves the int64 range throws a `RangeError` that is never swallowed.
- `parseAmountInput` returns `null` for malformed input, more than two decimals or a lone separator.

**Required tests**
- [ ] `sumMinorUnits` over 100,000 generated bigint amounts equals the independently computed exact total (validates NFR-01).
- [ ] `formatMoney` and `parseAmountInput` round-trip for `es-AR` and `en` without float (`1.234,56` is 123456n in `es-AR`) (validates AC-01).
- [ ] `parseAmountInput` returns null for `12,345` in `es-AR` (three decimals), `abc` and an empty string (invalid input).
- [ ] `addMinorUnits` throws a `RangeError` on int64 overflow (error path).
- [ ] The create schema rejects a missing name, type or currency and names the field (validates AC-02).
- [ ] The create schema offers exactly the five types (validates AC-03).
- [ ] The create schema fails with an invalid currency such as `EUR` (validates AC-04).
- [ ] The rename schema fails on an invalid body that carries `currency` or `type` (validates AC-05).
- [ ] The name schema fails on an invalid 51-code-point name and accepts 50, counting emoji as one (validates NFR-05).
- [ ] The list query schema fails on an invalid `limit` of 101 and accepts 100 (validates NFR-03).
- [ ] The create schema rejects an opening balance such as `1.5` or `1e3` (invalid amount).
- [ ] The create schema defaults an omitted opening balance to `"0"` (validates AC-16).
- [ ] The create schema accepts a negative opening balance such as `"-150000"` and the int64 minimum (validates AC-17).

**Completion criterion**
`pnpm test` runs the two new test files green, `pnpm typecheck` passes for `packages/shared`, and
`@argent/shared` exports `formatMoney`, `parseAmountInput`, `sumMinorUnits` and the account schemas.

## Block 2 — Error codes wiring (shared, API error handler, web client)

**Files**
- `packages/shared/src/errors.ts` (modified) — adds `ACCOUNT_NAME_TAKEN` and `ACCOUNT_HAS_MOVEMENTS` to `ERROR_CODES`.
- `apps/api/src/shared/http/error-handler.ts` (modified) — maps both codes to 409 in `STATUS_BY_CODE`.
- `apps/web/src/lib/api-client.ts` (modified) — adds `accountNameTaken` and `accountHasMovements` to `ApiErrorKey` and `MESSAGE_KEY_BY_CODE`.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — add the two keys under `errors`.
- `apps/api/test/foundation/error-handler.test.ts` (modified) — status cases.
- `apps/web/test/api-client.test.ts` (modified) — message key cases.

**Logic**
Adds the two typed error codes and keeps the exhaustive `Record` mappings compiling. The codes carry
no data: the API sends the code only and the web maps it to a message key (existing convention).
The 409 status is chosen because both conditions conflict with the current state of the resource.

**Error handling**
- An `AppError` with `ACCOUNT_NAME_TAKEN` answers 409 with only `{ code }` in the body.
- An `AppError` with `ACCOUNT_HAS_MOVEMENTS` answers 409 with only `{ code }` in the body.
- The web client maps an unknown code to `unexpected` and never shows API text.

**Required tests**
- [ ] The error handler answers 409 `ACCOUNT_NAME_TAKEN` with no extra fields (validates AC-13).
- [ ] The error handler answers 409 `ACCOUNT_HAS_MOVEMENTS` with no extra fields (validates AC-10).
- [ ] The web client maps both 409 codes to their message keys and an unknown code to `unexpected` (error path).
- [ ] `i18n-catalogs.test.ts` still passes: both catalogs carry the same keys.

**Completion criterion**
`pnpm typecheck` passes for `@argent/shared`, `@argent/api` and `@argent/web`, and the three
touched test files pass.

## Block 3 — Accounts domain and application (apps/api/src/accounts)

**Files**
- `apps/api/src/accounts/domain/account.ts` (new) — `Account` type and `balanceOf` helper.
- `apps/api/src/accounts/domain/errors.ts` (new) — `AccountNameTaken`, `AccountHasMovements` (extend `AppError`).
- `apps/api/src/accounts/application/ports/account-repository.ts` (new) — repository port.
- `apps/api/src/accounts/application/ports/account-movements.ts` (new) — movements port (Q2).
- `apps/api/src/accounts/application/create-account.ts`, `get-account.ts`, `list-accounts.ts`, `rename-account.ts`, `set-account-archived.ts` (archive and unarchive) and `delete-account.ts` (new) — one use case per file.
- `apps/api/src/accounts/index.ts` (new) — module barrel.
- `apps/api/test/accounts/account-use-cases.test.ts` (new) — unit tests with in-memory fakes.
- `apps/api/test/accounts/fakes.ts` (new) — in-memory repository and a configurable movements fake.

**Logic**
- Ports (no framework imports, so the lint boundaries hold):
  - `AccountRepository`: `create(scope write, data)` (the owner is the scope's user), `findById(scope, id)`, `list(scope, {archived, limit, offset})`
    returning `{ items, total }`, `listActive(scope)` returning `{ id, currency, openingBalance }[]`,
    `rename(scope write, id, name)`, `setArchived(scope write, id, archived)`, `delete(scope write, id)`.
    Reads take an `AccessScope`, writes (including create) an `AccessScope<'write'>`, imported from the `shared/access` barrel.
    Name conflicts surface as `AccountNameTaken`.
  - `AccountMovements`: `sumsByAccount(accountIds): Promise<ReadonlyMap<string, bigint>>` (signed minor
    units; an absent id means zero) and `hasMovements(accountId): Promise<boolean>`. It is the only door through which
    movements reach accounts; PRD 03 implements it. The port is unscoped by design: it is safe only because it receives ids the
    scoped repository returned, and the port's documentation says so.
- Use cases:
  - create: validated data, returns the account with `balance = openingBalance`.
  - list: one repository page plus `listActive`; one port call for the union of page ids and active ids (chunked in batches of at most 500 ids);
    balance per account is `openingBalance + sum`; totals per currency are the sum of balances of all active
    accounts (zero when there are none).
  - get, rename, archive, unarchive: repository calls with the scope; a missing row (or one outside the scope) is
    `ResourceNotFound`; archive and unarchive are idempotent.
  - delete: find with the write scope (404 if absent), `hasMovements` true throws `AccountHasMovements`,
    otherwise delete; a foreign-key violation raised by the repository also surfaces as `AccountHasMovements`.
- Money arithmetic uses `sumMinorUnits` and `addMinorUnits` from `@argent/shared`.

**Input validation**
- Use cases receive values already parsed by the shared schemas in Block 1; they re-check nothing
  except that `limit` and `offset` are inside the documented range (defence against a wrong caller).

**Error handling**
- Create or rename with a name already used by the owner (case-insensitive) raises `AccountNameTaken`.
- Delete of an account the movements port reports as used raises `AccountHasMovements` and keeps the row.
- Any operation on an id that is missing or owned by another user raises `ResourceNotFound`.
- A repository foreign-key violation on delete raises `AccountHasMovements`.
- A failing movements port propagates the error (no balance is guessed).

**Required tests**
- [ ] create returns the account with balance equal to the opening balance (validates AC-01).
- [ ] create with no opening balance stores 0 and a negative opening balance gives a negative balance (validates AC-16, AC-17).
- [ ] a rename persists and is returned by get and list (validates AC-06).
- [ ] archive hides the account from the default list, keeps it readable by id and deletes nothing; unarchive shows it again (validates AC-07, AC-08).
- [ ] delete removes an account with no movements (validates AC-09).
- [ ] delete of an account the fake port reports as used fails with the `AccountHasMovements` error and the row stays (validates AC-10).
- [ ] balance equals opening balance plus the fake port's sum, including a negative sum (validates AC-11).
- [ ] totals per currency equal the sum of active account balances and ignore archived ones, across pages (validates AC-12).
- [ ] create and rename reject a case-insensitive duplicate name with `AccountNameTaken` (validates AC-13).
- [ ] get, rename, archive, unarchive and delete of another user's account raise the `ResourceNotFound` error (404) and change nothing (validates AC-14).
- [ ] list returns only the caller's accounts (validates AC-15).
- [ ] a repository foreign-key violation on delete surfaces as the `AccountHasMovements` error (error path).
- [ ] a failing port makes list fail with the same error instead of returning balances (error path).
- [ ] the port is called in chunks of at most 500 ids when a user has 1,200 active accounts (validates NFR-02).

**Completion criterion**
`account-use-cases.test.ts` passes green, `pnpm lint` reports no boundary violation for
`apps/api/src/accounts/domain` and `application`, no file in `domain` imports `drizzle-orm`, `pg`,
`express` or anything under `infrastructure`, and no file in `application` imports anything under
`infrastructure` (including `shared/access/infrastructure`).

## Block 4 — Persistence: table, migration, repository, movements adapter

**Files**
- `apps/api/src/accounts/infrastructure/db/schema.ts` (new) — Drizzle table `accounts`; imports `users` from `identity/infrastructure/db/schema` for the foreign key.
- `apps/api/drizzle/0006_accounts.sql` (new, generated, then the trigger appended by hand) — provisional number, see Decisions.
- `apps/api/drizzle/meta/_journal.json` and `apps/api/drizzle/meta/0006_snapshot.json` (modified / new).
- `apps/api/drizzle/rollback/0006_accounts.down.sql` (new) — reverse script following the 0004 and 0005 convention.
- `apps/api/src/shared/db/pg-errors.ts` (new) — `violatedConstraint(error, code)` for 23505 and 23503 through the cause chain.
- `apps/api/src/identity/infrastructure/db/unique-violation.ts` (modified) — delegates to the shared helper so there is one copy.
- `apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts` (new) — implements the repository port.
- `apps/api/src/accounts/infrastructure/movements/no-movements-adapter.ts` (new) — returns an empty map and `false`.
- `apps/api/test/accounts/account-repository.test.ts` (new) — integration tests against PostgreSQL.
- `apps/api/test/identity/migration.test.ts` (modified) — migration count (7), rollback chains and a 0006 block.
- `apps/api/test/deploy/build-output.test.ts` (modified) — expects the `accounts` table after migrations (the list now also holds the 01c tables).

**Logic**
- Table, constraints and indexes as in the data model below.
- Repository: every method takes the scope first and builds its `WHERE` with `scopedTo(scope, { owner: accounts.ownerId })` in the same statement
  as the row filter (single statements, no check-then-act). A row outside the scope is indistinguishable from a missing one (`null` / `false`).
  Rename, archive and unarchive set `updated_at` explicitly. A unique violation on `accounts_owner_name_unique` becomes `AccountNameTaken`; a foreign-key violation (23503) on delete becomes
  `AccountHasMovements`. Sums of opening balances are never done in SQL floats; `bigint` mode is used for reads.
- A trigger rejects changing `type`, `currency` or `owner_id` after insert (FR-04, defence in depth).
- `NoMovementsAdapter` is the production adapter until PRD 03.
- Rollback (the migration is additive, so rolling back only loses accounts): run `0006_accounts.down.sql`, which drops the trigger, the function and the table
  and deletes the journal row whose `created_at` equals the journal `when` of 0006, then revert the commit. DESTRUCTIVE: every account is lost, so it needs an explicit plan
  and the API stopped. Apply it before `0005_two_factor.down.sql` when rolling back further.

**Data model**
- Entity `accounts`: `id` uuid primary key default `gen_random_uuid()`; `owner_id` uuid not null, foreign key to `users.id` on delete cascade;
  `name` text not null with a check of 1 to 50 on `char_length(name)`; `type` text not null with a check in the five type values;
  `currency` text not null with a check in (`ARS`, `USD`); `opening_balance` bigint not null (no default, no float column);
  `archived_at` timestamptz nullable; `created_at` and `updated_at` timestamptz not null default `now()`.
- Unique index `accounts_owner_name_unique` on (`owner_id`, `lower(name)`) (FR-11, case-insensitive per owner).
- Index `accounts_owner_created_idx` on (`owner_id`, `created_at`, `id`) for the paginated list and the owner filter (NFR-02, NFR-04).
- Trigger function `accounts_immutable_fields()` raising check-violation (23514) when `type`, `currency` or `owner_id` changes.

**Error handling**
- Insert or rename colliding on the unique name index raises `AccountNameTaken`, never a raw driver error.
- Delete blocked by a referencing row (foreign key 23503) raises `AccountHasMovements`.
- An update that changes `type`, `currency` or `owner_id` fails at the database with 23514 and the row is unchanged.
- A name longer than 50 characters or empty fails the check constraint (defence behind the request validation).
- Any other database error propagates and becomes 500 `INTERNAL` through the shared error handler.

**Required tests**
- [ ] the repository creates and reads an account with bigint opening balances beyond 2^53 without losing precision (validates AC-01, NFR-01).
- [ ] rename persists (validates AC-06); archive and unarchive toggle `archived_at` and the default list excludes archived rows (validates AC-07, AC-08).
- [ ] delete of an unreferenced account removes it (validates AC-09).
- [ ] delete of an account referenced by a test-only table with `ON DELETE RESTRICT` fails with the `AccountHasMovements` error and the row stays (validates AC-10).
- [ ] `Caja` and `caja` for the same owner conflict with the duplicate-name `AccountNameTaken` error; the same name for two owners is accepted (validates AC-13).
- [ ] a raw `UPDATE` of currency or type fails with the 23514 error and leaves the row unchanged (validates AC-05).
- [ ] reading, renaming, archiving, unarchiving and deleting another owner's id return `null` / `false` (the 404 case) and change nothing (validates AC-14, NFR-04).
- [ ] list returns only the caller's rows, orders by `created_at, id` and honours `limit` and `offset` (validates AC-15, NFR-03).
- [ ] the check constraints fail on an invalid 51-character name, an empty name, a type outside the five and a currency such as `EUR` (validates NFR-05).
- [ ] an unexpected driver error propagates unchanged instead of being mapped to a domain error (error path).
- [ ] the identity helper still reports the violated unique constraint through the shared helper (existing identity tests stay green).
- [ ] `migration.test.ts`: all migrations apply on an empty database, the 0006 rollback and re-apply work, and every rollback chain runs `0006_accounts` before `0005_two_factor`.
- [ ] `build-output.test.ts`: the built migrator creates the `accounts` table.

**Completion criterion**
The integration tests, `migration.test.ts` and `build-output.test.ts` pass against PostgreSQL,
`pnpm db:generate` reports no pending schema difference, and no raw SQL outside the migration file
and the hand-appended trigger is added.

## Block 5 — HTTP routes and wiring

**Files**
- `apps/api/src/accounts/infrastructure/http/account-routes.ts` (new) — `RouterFactory` for `/accounts`.
- `apps/api/src/accounts/infrastructure/http/account-presenter.ts` (new) — maps the domain account (`bigint`) to the response (decimal strings).
- `apps/api/src/accounts/index.ts` (modified) — exports `createAccountRoutes`.
- `apps/api/src/server.ts` (modified) — mounts the factory through `routerFactories`.
- `apps/api/test/accounts/account-routes.test.ts` (new) — HTTP integration tests through the identity harness with real sessions.

**Logic**
`createAccountRoutes({ db, movements? })` builds the repository and the service (default movements adapter: `NoMovementsAdapter`) and returns a
`RouterFactory` that mounts `requireSession` and `requireVerifiedEmail` on `/accounts`, then each route with the shared `validate` middleware.
The scope comes from `OwnerOrGroupMemberAccessPolicy` with the deny-all membership reader (`scopeFor(auth, 'read' | 'write')`), exactly as the
fixture template; an empty result becomes 404 through `notFoundUnlessAllowed`. The bigint-to-string conversion happens only in the presenter, never in the domain or the use cases. Create, archive, unarchive and delete write an audit log line with the user id and the account id only (never the name or any amount). `createApp` does not self-mount the module; `server.ts` passes the
factory. `worker.ts` is unchanged.

**API contract**
- `POST /accounts` — Request body: `name`, `type`, `currency`, `openingBalance` (optional decimal string, default `"0"`, negatives allowed). Response 201: `AccountResponse`. Errors: 400 `VALIDATION_FAILED` (with `fields`), 401, 403 `EMAIL_NOT_VERIFIED`, 409 `ACCOUNT_NAME_TAKEN`. Auth: session cookie plus verified email.
- `GET /accounts` — Query: `archived` (`true`/`false`, default false), `limit` (1 to 100, default 50), `offset`. Response 200: `{ items: AccountResponse[], totals: { ARS, USD }, total, limit, offset }`. Errors: 400, 401, 403. Auth: session plus verified email.
- `GET /accounts/:id` — Params: `id` UUID. Response 200: `AccountResponse` (archived accounts included). Errors: 400, 401, 403, 404. Auth: session plus verified email.
- `PATCH /accounts/:id` — Params: `id`. Request body: `name` only (`type` or `currency` present means 400). Response 200: `AccountResponse`. Errors: 400, 401, 403, 404, 409 `ACCOUNT_NAME_TAKEN`. Auth: session plus verified email.
- `POST /accounts/:id/archive` and `POST /accounts/:id/unarchive` — Params: `id`; empty request body. Response 200: `AccountResponse`, idempotent. Errors: 400, 401, 403, 404. Auth: session plus verified email.
- `DELETE /accounts/:id` — Params: `id`. Response 204. Errors: 400, 401, 403, 404, 409 `ACCOUNT_HAS_MOVEMENTS`. Auth: session plus verified email.
- State-changing methods also need the web origin and `X-Requested-With: argent` (existing origin guard).

**Input validation**
- Every route validates params, query and body with the shared schemas of Block 1 through `validate`; handlers never read `req.body`.
  Identifiers are UUIDs; unknown body keys are stripped; `type` and `currency` on PATCH fail.

**Error handling**
- Validation failures answer 400 `VALIDATION_FAILED` with field paths and never echo the submitted values.
- A missing, malformed or expired session answers 401; an unverified email answers 403 `EMAIL_NOT_VERIFIED`.
- Another user's account answers 404 `NOT_FOUND`, identical to a missing id.
- A duplicate name answers 409 `ACCOUNT_NAME_TAKEN`; deleting an account with movements answers 409 `ACCOUNT_HAS_MOVEMENTS`.
- A response body that does not match its schema becomes 500 `INTERNAL` (fail closed), never a leak.

**Required tests**
- [ ] create returns 201 and the account appears in the list with its opening balance (validates AC-01).
- [ ] create rejects a missing name, type or currency with 400 naming `body.name`, `body.type` or `body.currency` (validates AC-02).
- [ ] create rejects currency `EUR` with 400 (validates AC-04).
- [ ] create without `openingBalance` returns 201 with `openingBalance` and `balance` equal to `"0"` (validates AC-16).
- [ ] create with a negative `openingBalance` returns 201 and the list shows the negative balance (validates AC-17).
- [ ] PATCH with `currency` or `type` returns 400 and the account is unchanged (validates AC-05).
- [ ] PATCH renames and the new name is returned by GET and the list (validates AC-06).
- [ ] archive removes the account from the default list, keeps GET by id working and keeps it in `archived=true` (validates AC-07); unarchive restores it (validates AC-08).
- [ ] DELETE returns 204 for an account without movements (validates AC-09).
- [ ] DELETE returns 409 `ACCOUNT_HAS_MOVEMENTS` when a test movements adapter reports movements and the account remains (validates AC-10).
- [ ] list balances equal the opening balance with the default adapter and equal opening plus the test adapter's sum (validates AC-11).
- [ ] list totals per currency equal the sum of active balances, over more than one page (validates AC-12).
- [ ] create and PATCH reject a case-insensitive duplicate with 409 `ACCOUNT_NAME_TAKEN` (validates AC-13).
- [ ] GET, PATCH, archive, unarchive and DELETE on another user's account answer 404 with the same body as a missing id (validates AC-14).
- [ ] the list shows only the caller's accounts (validates AC-15).
- [ ] the audit log line of a mutating route holds the user id and account id and neither the name nor an amount (validates NFR-04).
- [ ] every route answers 401 without a session and 403 `EMAIL_NOT_VERIFIED` for an unverified user (error path).
- [ ] `limit` 101 answers 400 and `limit` 100 is accepted (validates NFR-03).
- [ ] a state-changing request without the origin header answers 403 (error path).

**Completion criterion**
`account-routes.test.ts` passes, `GET /accounts` answers 200 for a verified user when the factory is
mounted through `createApp`'s `routerFactories` (as `server.ts` does), and `pnpm typecheck` and `pnpm lint`
pass for `apps/api`.

## Block 6 — Web API client methods

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — account methods; `RequestOptions.method` widened to include `PATCH` and `DELETE`.
- `apps/web/test/api-client.test.ts` (modified) — tests for the new methods.

**Logic**
Adds `listAccounts(query)`, `createAccount(body)`, `getAccount(id)`, `renameAccount(id, body)`, `archiveAccount(id)`, `unarchiveAccount(id)` and
`deleteAccount(id)` to `ApiClient`. All are session-bound (`refreshOnUnauthenticated`), parse responses with the shared response schemas and
map error codes to message keys already added in Block 2. The query for the list call is built with `URLSearchParams` from validated values only.

**Input validation**
- Request bodies are built from values the containers validated with the shared schemas; the client encodes the id in the path with
  `encodeURIComponent` and sends no other user-controlled path segment.

**Error handling**
- A network failure returns `{ ok: false, code: 'NETWORK' }`.
- A 409 `ACCOUNT_NAME_TAKEN` returns the failure with `accountNameTaken`.
- A 409 `ACCOUNT_HAS_MOVEMENTS` returns the failure with `accountHasMovements`.
- A response that does not match its schema returns `INTERNAL` instead of throwing.

**Required tests**
- [ ] `createAccount` sends the body with credentials and the `X-Requested-With` header and returns the parsed account (validates AC-01).
- [ ] `renameAccount` uses `PATCH` with the encoded id and returns the parsed account (validates AC-06).
- [ ] `archiveAccount`, `unarchiveAccount` and `deleteAccount` use the right method and path; delete accepts an empty 204 (validates AC-07, AC-08, AC-09).
- [ ] `listAccounts` serializes `archived`, `limit` and `offset` and parses totals as strings (validates AC-12).
- [ ] a 409 answer with `ACCOUNT_NAME_TAKEN` maps to `accountNameTaken` (validates AC-13).
- [ ] a 409 answer with `ACCOUNT_HAS_MOVEMENTS` maps to `accountHasMovements` (validates AC-10).
- [ ] a network failure returns the `NETWORK` error result without throwing (error path).
- [ ] an invalid response body returns the `INTERNAL` error result without throwing (error path).

**Completion criterion**
`api-client.test.ts` passes and `pnpm typecheck` passes for `apps/web`.

## Block 7 — Web accounts screens

**Files**
- `apps/web/src/components/ui/select.tsx` (new) — native `<select>` styled with theme tokens, no new dependency.
- `apps/web/src/features/accounts/components/account-form.tsx` (new) — presentational create form.
- `apps/web/src/features/accounts/components/account-list.tsx` (new) — presentational list with totals, row actions and confirmations.
- `apps/web/src/features/accounts/containers/accounts-container.tsx` (new) — loads, renames, archives, unarchives and deletes.
- `apps/web/src/features/accounts/containers/create-account-container.tsx` (new) — validates and creates.
- `apps/web/src/app/[locale]/(app)/accounts/page.tsx` and `apps/web/src/app/[locale]/(app)/accounts/new/page.tsx` (new) — routes.
- `apps/web/src/app/[locale]/(app)/page.tsx` (modified) — link to the accounts screen.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — `accounts` namespace.
- `apps/web/test/accounts-components.test.tsx`, `apps/web/test/accounts-containers.test.tsx` and `apps/web/test/routes.test.tsx` (new / modified).

**Logic**
- Container/presentational split: components are pure and fetch nothing; containers use `useApiClient`.
- The create form has name, type (the five types from `ACCOUNT_TYPES`, labelled through the catalog), currency (ARS or USD) and an optional opening-balance
  field parsed with `parseAmountInput` for the active locale (pre-filled with `0`; negatives accepted; an empty field is sent as omitted); the container validates with `createAccountRequestSchema`
  and shows per-field messages (AC-02).
- The list shows each active account with its balance formatted by `formatMoney` and the two totals; a toggle shows archived accounts.
  Rename is inline; archive and unarchive are buttons; delete asks for confirmation inline and, on `accountHasMovements`, shows the message and an
  "archive instead" action (AC-10). Failures use the existing alert pattern; offline shows the retry state.
- The `page.tsx` files are thin Server Components that render the client containers; no Server Component reads financial data (all of it goes through the API). Dates are not displayed in this ticket.
- Strings come only from the catalogs, in Spanish and English; amounts and dates use locale formatters.
- No account picker exists yet (no consumer before PRD 03); the API list is the picker source.

**Input validation**
- Form fields are validated client-side with the shared Block 1 schemas (name 1 to 50 code points, type, currency, amount through
  `parseAmountInput`, null means a field error); the API remains the authority.

**Error handling**
- A missing name, type or currency shows the field's error message and sends no request.
- A malformed opening balance shows an amount error and sends no request.
- `accountNameTaken` shows the duplicate-name message on the name field.
- `accountHasMovements` shows the message with the archive action.
- A network or unexpected failure shows the retry alert and keeps the typed values.

**Required tests**
- [ ] the form offers exactly the five account types and the two currencies (validates AC-03).
- [ ] submitting valid values calls `createAccount` once and navigates to the list (validates AC-01).
- [ ] the opening-balance field is pre-filled with 0, an empty field is sent as omitted, and `-1.500,00` in `es` is sent as a negative amount (validates AC-16, AC-17).
- [ ] submitting without name, type or currency shows each field error and calls nothing (validates AC-02).
- [ ] a malformed amount shows an error and calls nothing (invalid input).
- [ ] rename shows the new name in the list (validates AC-06).
- [ ] archive removes the row from the active view and unarchive from the archived view restores it (validates AC-07, AC-08).
- [ ] delete asks for confirmation and removes the row (validates AC-09).
- [ ] a 409 on delete shows the message and the archive action (validates AC-10).
- [ ] balances and both totals are shown with locale formatting from the API strings (validates AC-11, AC-12).
- [ ] a duplicate name answer shows the name error (validates AC-13).
- [ ] a network failure shows the retry state and keeps the typed values (error path).
- [ ] an account name containing markup is rendered as literal text and never interpreted (validates NFR-05).
- [ ] `routes.test.tsx` renders both pages, and `i18n-catalogs.test.ts` still passes (keys match in es and en).

**Completion criterion**
The three web test files and `i18n-catalogs.test.ts` pass, `pnpm typecheck` and `pnpm lint` pass for
`apps/web`, and the two pages render in `es` and `en` without hardcoded strings.

## Block 8 — End-to-end, performance and boundary tests

**Files**
- `apps/web/e2e/accounts.spec.ts` (new) — Playwright flow with a fresh verified user.
- `apps/api/test/perf/accounts-list.perf.test.ts` (new) — latency benchmark following `auth-latency.perf.test.ts`.
- `apps/api/test/foundation/architecture-boundaries.test.ts` (modified) — probes for `apps/api/src/accounts/domain` (I/O libraries and infrastructure) and `apps/api/src/accounts/application` (infrastructure, including `shared/access/infrastructure`).

**Logic**
- The e2e spec registers and verifies a user through Mailpit like `auth.spec.ts`, then creates an ARS and a USD account, checks balances and
  totals, renames, archives, unarchives, deletes an unused account and checks a duplicate-name message. Copy comes from `e2e/support/catalogs.ts`.
- The performance test builds the app through `createIdentityHarness` with real sessions and the accounts factory, seeds 100 accounts for one user
  and 100,000 rows in a test-only movements table, injects a test adapter implementing `AccountMovements` with one `GROUP BY account_id` query,
  drives the list call with `limit=100` through autocannon and asserts p95 below 300 ms (NFR-02).
- The boundary probes assert that the domain folder of `accounts` rejects `drizzle-orm`, `pg`, `express` and infrastructure imports, and that the application folder rejects infrastructure imports.

**Data model**
- Test-only table `perf_movements` created and dropped by the performance test: `account_id` uuid not null, `amount` bigint not null, with an index on
  `account_id`. It lives only in the test and is never part of a migration.

**Error handling**
- If the benchmark cannot seed or reach the database it fails the run instead of skipping.
- The e2e spec fails on any console error or unexpected status instead of retrying silently.
- A boundary probe that unexpectedly passes fails the test.

**Required tests**
- [ ] e2e: a user creates an account in each currency and sees both balances and totals (validates AC-01, AC-11, AC-12).
- [ ] e2e: an account created with the pre-filled 0 and another with a negative opening balance show 0 and the negative amount (validates AC-16, AC-17).
- [ ] e2e: the create form shows an error for a missing name and the five types are offered (validates AC-02, AC-03).
- [ ] e2e: rename, archive, unarchive and delete update the list (validates AC-06, AC-07, AC-08, AC-09).
- [ ] e2e: a duplicate name shows an error message (validates AC-13).
- [ ] e2e: a second user never sees the first user's accounts (validates AC-15).
- [ ] perf: p95 of the list for 100 accounts and 100,000 movement rows is below 300 ms (validates NFR-02).
- [ ] boundary probes reject forbidden imports in the accounts domain and application folders (error path).

**Completion criterion**
`pnpm e2e` passes the new spec, `pnpm test:perf` passes the new benchmark with its p95 recorded in the
test output, and `pnpm test` stays green including the boundary probes.

## Block 9 — Opening balance bound, name characters and exact arithmetic (packages/shared)

**Files**
- `packages/shared/src/money.ts` (modified) — exact (non-int64) derived-value helpers and validator.
- `packages/shared/src/accounts/account.ts` (modified) — opening balance bound, name character rule, response schemas for balances and totals.
- `apps/api/test/shared/money.test.ts` (modified) — tests for the exact helpers.
- `apps/api/test/shared/account-contracts.test.ts` (modified) — tests for the bound, the name rule and the response schemas.

**Logic**
- `money.ts` adds `exactIntegerStringSchema` (a decimal integer string of at most 40 digits and an optional minus, no int64 range) for derived values that are never stored, and `addExact` / `sumExact`, plain `bigint` arithmetic with no range check and no `RangeError`. The int64 helpers (`minorUnitsStringSchema`, `addMinorUnits`, `sumMinorUnits`) stay for stored amounts.
- `account.ts` adds `OPENING_BALANCE_LIMIT_MINOR_UNITS` (10^15 as `bigint`) and `openingBalanceSchema` (the int64 string validator plus an absolute value of at most the limit); `createAccountRequestSchema.openingBalance` uses it with the default `"0"`.
- `accountNameSchema` rejects any name containing a character of Unicode category Cc or Cf (`/[\p{Cc}\p{Cf}]/u`) after the NFC and trim steps; a name that is empty after trimming still fails the length rule. The same validator serves create and rename.
- `accountResponseSchema.balance` and `listAccountsResponseSchema.totals` use `exactIntegerStringSchema`; `openingBalance` keeps the int64 validator.

**Input validation**
- Opening balance: a decimal integer string inside plus or minus 10^15 minor units. Name: trimmed, NFC, 1 to 50 code points, no Cc or Cf character. Response balances and totals: any integer string of up to 40 digits.

**Error handling**
- An opening balance above 10^15 or below -10^15 fails validation with the field path `body.openingBalance`.
- A name that contains a control or format character fails validation with the field path `body.name`.
- A name made only of whitespace, control or format characters fails validation as an empty name.
- A balance or total that is not an integer string, or that has more than 40 digits, fails response validation.

**Required tests**
- [ ] The create schema fails with an invalid opening balance of 10^15 + 1 and of -(10^15 + 1) and names `openingBalance` (validates AC-18).
- [ ] The create schema accepts an opening balance of exactly 10^15 and of exactly -10^15 (validates AC-19).
- [ ] The name schema fails on an invalid name with a zero-width space, a right-to-left override, a NUL character and a soft hyphen, for create and for rename (validates AC-20).
- [ ] The name schema fails on an invalid name made only of spaces, only of zero-width characters, or of both (validates AC-21).
- [ ] The response schemas accept a total of 9,300 times 10^15 and a balance beyond the int64 maximum, and fail on a non-integer or 41-digit string (validates AC-22).
- [ ] `sumExact` over 100,000 amounts of 10^15 equals exactly 10^20 with no error, and `addExact` of two int64 maxima equals twice the maximum (validates NFR-06).

**Completion criterion**
The two shared test files pass, `pnpm --filter @argent/shared typecheck` and `pnpm --filter @argent/api typecheck` pass, and `@argent/shared` exports `addExact`, `sumExact`, `exactIntegerStringSchema` and `OPENING_BALANCE_LIMIT_MINOR_UNITS`.

## Block 10 — Exact balances and totals, bound enforced in the database and the routes (API)

**Files**
- `apps/api/src/accounts/domain/account.ts` (modified) — `balanceOf` uses `addExact`.
- `apps/api/src/accounts/application/list-accounts.ts` (modified) — totals use `sumExact`.
- `apps/api/src/accounts/infrastructure/db/schema.ts` (modified) — check constraint on the opening balance.
- `apps/api/drizzle/0006_accounts.sql`, `apps/api/drizzle/meta/0006_snapshot.json`, `apps/api/drizzle/meta/_journal.json` and `apps/api/drizzle/rollback/0006_accounts.down.sql` (modified) — the unmerged migration is regenerated in place (it was never pushed or deployed); the rollback script keeps the journal row delete in step with the new journal `when`.
- `apps/api/test/accounts/account-use-cases.test.ts`, `apps/api/test/accounts/account-repository.test.ts`, `apps/api/test/accounts/account-routes.test.ts` and `apps/api/test/identity/migration.test.ts` (modified) — the new tests.

**Logic**
- `balanceOf` and the per-currency totals use the exact helpers of Block 9, so neither can throw `RangeError`; stored values keep int64.
- The table gets `CHECK (opening_balance between -1000000000000000 and 1000000000000000)` named `accounts_opening_balance_range_check` as a second line of defence behind the shared schema, which makes `POST /accounts` answer 400 for out-of-range values before the database is reached.
- Names are validated by the shared schema on `POST /accounts` and `PATCH /accounts/:id`; no route changes beyond using the amended schemas.
- Tests that stored int64 extremes as an opening balance (the repository precision test beyond 2^53, the int64 minimum in the contract, route and AC-17 tests) are rewritten to the new bound of 10^15, which is below 2^53; precision beyond 2^53 is now exercised on derived values (the exact sums of Block 9 and the 9,300-account total) and no existing assertion is weakened.
- Rollback and migration: the migration is regenerated with `drizzle-kit generate` after removing the unmerged 0006 files and journal entry, and the hand-appended trigger is kept; the rollback script's journal `created_at` is updated to the new `when`.

**API contract**
- `POST /accounts` — Request body: `name`, `type`, `currency`, optional `openingBalance`. Response 201: `AccountResponse`. Errors: 400 `VALIDATION_FAILED` naming `body.openingBalance` when outside plus or minus 10^15 minor units and `body.name` for a name with control or format characters, 401, 403, 409. Auth: session cookie plus verified email.
- `PATCH /accounts/:id` — Request body: `name` only. Response 200: `AccountResponse`. Errors: 400 `VALIDATION_FAILED` naming `body.name` for control or format characters, 401, 403, 404, 409. Auth: session plus verified email.
- `GET /accounts` — Response 200 with exact `totals` as integer strings of any size up to 40 digits. Errors: 400, 401, 403. Auth: session plus verified email.

**Data model**
- Entity `accounts`: adds the check constraint `accounts_opening_balance_range_check` on `opening_balance` (not null `bigint`, plus or minus 10^15); no other column, unique index or foreign key changes.

**Input validation**
- Create and rename bodies use the amended shared schemas of Block 9; `limit` and `offset` are unchanged.

**Error handling**
- An opening balance outside plus or minus 10^15 answers 400 naming the field and creates nothing, never 500.
- A name with a control or format character, or empty after trimming, answers 400 naming `body.name` on create and on rename, and leaves the account unchanged.
- A row written around the API with an opening balance outside the bound fails the check constraint (23514) and propagates unchanged.
- Totals and balances never raise `RangeError`.

**Required tests**
- [ ] The use cases return exact totals above the int64 maximum for 9,300 active accounts at 10^15, without throwing (validates AC-22, NFR-06).
- [ ] The repository fails with a 23514 check violation for an opening balance of 10^15 + 1 and accepts exactly 10^15 and -10^15 (validates FR-13, AC-19).
- [ ] The routes answer 400 for an opening balance of 10^15 + 1 and of -(10^15 + 1) naming `body.openingBalance`, and no account exists afterwards (validates AC-18).
- [ ] The routes answer 201 for an opening balance of exactly 10^15 and exactly -10^15 (validates AC-19).
- [ ] The routes answer 400 naming `body.name` for create and for PATCH with a zero-width space, a right-to-left override and a NUL character, and the account is unchanged (validates AC-20).
- [ ] The routes answer 400 for create and PATCH with a name made only of spaces or only of zero-width characters (validates AC-21).
- [ ] `GET /accounts` for a user with 9,300 ARS accounts at 10^15 (seeded with one `generate_series` insert) answers 200 with the exact ARS total 9300000000000000000 for both the active list and the response parse (validates AC-22, NFR-06).
- [ ] `migration.test.ts`: the regenerated 0006 applies, rolls back, re-applies, and the check constraint is present and fails an out-of-range insert (error path).

**Completion criterion**
The three accounts test files and `migration.test.ts` pass, `pnpm exec drizzle-kit generate` reports no pending change, and `GET /accounts` answers 200 with the exact total in the 9,300-account test.

## Block 11 — Web messages for the new rules and end-to-end coverage

**Files**
- `apps/web/src/features/accounts/account-form-errors.ts` (modified) — `nameErrorMessage` and the message type.
- `apps/web/src/features/accounts/containers/create-account-container.tsx` and `apps/web/src/features/accounts/components/account-field.tsx` (modified as needed) — the out-of-range amount message with the formatted limit.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — `accounts.errors.nameInvalidCharacters` and `accounts.errors.amountOutOfRange`.
- `apps/web/test/accounts-components.test.tsx` and `apps/web/test/accounts-containers.test.tsx` (modified) — new tests.
- `apps/web/e2e/accounts.spec.ts` (modified) — new flows.

**Logic**
- `nameErrorMessage(name)` answers `nameInvalidCharacters` when the name has visible text and a Cc or Cf character, `nameRequired` when nothing is left once whitespace, control and format characters are ignored, and `nameTooLong` above 50 code points; the rule uses the same Unicode categories as the shared validator.
- The create container validates the amount with the shared opening-balance validator after `parseAmountInput`; an amount outside plus or minus 10^15 minor units shows `amountOutOfRange` with the limit formatted by `formatMoney` for the active locale, and sends no request.
- Copy comes from the catalogs in English and neutral Spanish; the limit is interpolated, never hardcoded.

**Input validation**
- The form fields use the shared schemas of Block 9; the API stays the authority.

**Error handling**
- A name with a control or format character next to visible text shows the invalid-characters message and sends no request.
- A name with nothing visible shows the name-required message and sends no request.
- An opening balance beyond the limit shows the out-of-range message with the formatted limit and sends no request.

**Required tests**
- [ ] `nameErrorMessage` returns the invalid-characters key for `Caja` plus a zero-width space and a right-to-left override, the required key for only zero-width characters or only spaces, and the too-long key above 50 code points (validates AC-20, AC-21).
- [ ] The create container shows the invalid-characters message for a name with a zero-width character and calls nothing (validates AC-20).
- [ ] The create container shows the name-required message for a zero-width-only name and calls nothing (validates AC-21).
- [ ] The create container shows the out-of-range message with the formatted limit for `10.000.000.000.000,01` typed in `es` and calls nothing; the limit `10.000.000.000.000,00` and its negative are sent (validates AC-18, AC-19).
- [ ] The catalogs keep the same keys in es and en (`i18n-catalogs.test.ts`) and the message copy for the two new keys exists in both languages (error path).
- [ ] e2e: the form refuses an opening balance beyond the limit and a zero-width-only name, shows the messages, and creates nothing (validates AC-18, AC-21).

**Completion criterion**
The two web test files and `i18n-catalogs.test.ts` pass, `pnpm --filter @argent/web typecheck` passes, and `pnpm e2e` passes the amended `accounts.spec.ts` with free ports 3000, 4000 and 4100.

## Final verification
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (80% floor over the three trees), `pnpm test:perf`
  and `pnpm e2e` pass.
- Every FR-01 to FR-12 and AC-01 to AC-15 maps to a test above; the deferrals to PRD 03 are the ones listed
  and nothing else.
- `pnpm audit --prod --audit-level high` is unchanged: no runtime dependency is added to any package.
- No float is used for money anywhere, including tests; no movements table exists in any migration.
- Rollback: `0006_accounts.down.sql` drops the table and the trigger (destructive, explicit plan required);
  the rest of the change is reverted with the commit.
