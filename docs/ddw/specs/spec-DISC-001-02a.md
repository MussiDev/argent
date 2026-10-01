# Spec DISC-001-02a: Accounts

| Field | Value |
|-------|-------|
| Ticket | DISC-001-02a |
| PRD | docs/ddw/prd/prd-DISC-001-02a.md |
| Tier | FEATURE |
| Date | 2026-10-01 |
| Spec loops | 2 |
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
- **Migration number:** `0005_accounts` is provisional. DISC-001-01c (`0005_two_factor`),
  DISC-001-01d and the 07a ticket also claim 0005; whichever merges later renumbers its files
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
- **Q5, opening balance sign:** the opening balance may be negative; any value inside the signed
  64-bit range is accepted, including zero and negatives (FR-01, AC-17).
- **Q6, opening balance optional:** the opening balance is not required; when omitted the API
  stores `0` and the web form pre-fills `0` (FR-01, AC-16). This amended the PRD through the PLAN to
  DEFINE corrective loop (PRD loops 2).
- **Q7, no cap on accounts per user and no extra write-rate limit:** the human decided to keep it as
  built. Cost is bounded by pagination, indexes, aggregate queries and the 500-id chunking. The
  threat model records it as accepted risk R-15.
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
| FR-10 | Block 3, Block 5, Block 6, Block 7 |
| FR-11 | Block 2, Block 3, Block 4, Block 5 |
| FR-12 | Block 3, Block 4, Block 5 |
| NFR-01 | Strategy: bigint minor units in a `bigint` column, decimal strings in JSON, all sums through the shared helpers (Block 1); a unit test sums 100,000 amounts and compares to the exact expected total (Block 1) |
| NFR-02 | Strategy: balances computed on read with one batched port call and aggregate queries (Block 3); the list query uses the owner index (Block 4); a performance test with a test-only 100,000-row movements table asserts p95 under 300 ms (Block 8) |
| NFR-03 | Strategy: the list query schema caps `limit` at 100 and rejects larger values with 400 (Block 1, Block 5) |
| NFR-04 | Strategy: every repository method requires an `AccessScope` and filters with `scopedTo` in the same statement (Block 4); the owner column is `NOT NULL` with a foreign key (Block 4) |
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
- Names: string, trimmed, NFC, 1 to 50 code points. Type: one of the five values. Currency: `ARS`
  or `USD` only. Amounts: decimal integer strings inside int64 (negatives allowed; the opening balance may be omitted). `limit` at most 100. Unknown keys are
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
- `apps/api/drizzle/0005_accounts.sql` (new, generated, then the trigger appended by hand) — provisional number, see Decisions.
- `apps/api/drizzle/meta/_journal.json` and `apps/api/drizzle/meta/0005_snapshot.json` (modified / new).
- `apps/api/drizzle/rollback/0005_accounts.down.sql` (new) — reverse script following the 0004 convention.
- `apps/api/src/shared/db/pg-errors.ts` (new) — `violatedConstraint(error, code)` for 23505 and 23503 through the cause chain.
- `apps/api/src/identity/infrastructure/db/unique-violation.ts` (modified) — delegates to the shared helper so there is one copy.
- `apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts` (new) — implements the repository port.
- `apps/api/src/accounts/infrastructure/movements/no-movements-adapter.ts` (new) — returns an empty map and `false`.
- `apps/api/test/accounts/account-repository.test.ts` (new) — integration tests against PostgreSQL.
- `apps/api/test/identity/migration.test.ts` (modified) — migration count, rollback chains and a 0005 block.
- `apps/api/test/deploy/build-output.test.ts` (modified) — expects the `accounts` table after migrations.

**Logic**
- Table, constraints and indexes as in the data model below.
- Repository: every method takes the scope first and builds its `WHERE` with `scopedTo(scope, { owner: accounts.ownerId })` in the same statement
  as the row filter (single statements, no check-then-act). A row outside the scope is indistinguishable from a missing one (`null` / `false`).
  Rename, archive and unarchive set `updated_at` explicitly. A unique violation on `accounts_owner_name_unique` becomes `AccountNameTaken`; a foreign-key violation (23503) on delete becomes
  `AccountHasMovements`. Sums of opening balances are never done in SQL floats; `bigint` mode is used for reads.
- A trigger rejects changing `type`, `currency` or `owner_id` after insert (FR-04, defence in depth).
- `NoMovementsAdapter` is the production adapter until PRD 03.
- Rollback (the migration is additive, so rolling back only loses accounts): run `0005_accounts.down.sql`, which drops the trigger, the function and the table
  and deletes the journal row whose `created_at` equals the journal `when` of 0005, then revert the commit. DESTRUCTIVE: every account is lost, so it needs an explicit plan
  and the API stopped. Apply it before `0004_google_identity.down.sql` when rolling back further.

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
- [ ] `migration.test.ts`: all migrations apply on an empty database, the 0005 rollback and re-apply work, and the rollback chains run 0005 first.
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

## Final verification
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (80% floor over the three trees), `pnpm test:perf`
  and `pnpm e2e` pass.
- Every FR-01 to FR-12 and AC-01 to AC-15 maps to a test above; the deferrals to PRD 03 are the ones listed
  and nothing else.
- `pnpm audit --prod --audit-level high` is unchanged: no runtime dependency is added to any package.
- No float is used for money anywhere, including tests; no movements table exists in any migration.
- Rollback: `0005_accounts.down.sql` drops the table and the trigger (destructive, explicit plan required);
  the rest of the change is reverted with the commit.
