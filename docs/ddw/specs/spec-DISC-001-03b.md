# Spec DISC-001-03b: Expense and Income

| Field | Value |
|-------|-------|
| Ticket | DISC-001-03b |
| PRD | docs/ddw/prd/prd-DISC-001-03b.md |
| Tier | FEATURE |
| Date | 2026-10-02 |
| Spec loops | 1 |
| Loops since last human decision | 1 |

## Summary
A new module `apps/api/src/movements/` (hexagonal, mirroring `accounts` and `categories`) stores expenses and
income in one `movements` relation. Each row freezes the ARS-per-USD rate used, as a bigint scaled by 10,000, with
its source (`automatic` plus the rate type, or `manual`). The rate is resolved on the server from the stored rates
of DISC-001-03a, so the module has no provider dependency and `exchange_rates` is only read. The module supplies
the real adapters of the two ports the earlier tickets left open (`AccountMovements` and `CategoryUsage`), which
makes balances, the FEAT-003 Available and Net worth totals and the "cannot delete" rules real. The relation
references accounts and categories with composite foreign keys `ON DELETE RESTRICT`, which also make the database
enforce that the account belongs to the same owner and that the category kind equals the movement type. User
deletion locks the user row, erases the user's movements first through an ordered erasure step injected into the
01f deletion transaction from the composition root, and the 01f erasure guard learns the policy `erase-step`. The web
app gets a movements list and an entry screen that prefills the rate from the stored rates and shows its age.

Design decisions taken in this spec. None changes a PRD requirement; Q1 and Q2 need the human's answer before CODE:
- **Q1 (open, human): which timestamp drives the rate age** of FR-11 and AC-11, the provider's update time
  (`providerUpdatedAt`) or the time of our refresh (`fetchedAt`). Both are already stored and returned by
  DISC-001-03a. The spec isolates the choice in one exported constant `RATE_AGE_BASIS` and one function
  `rateAgeMs(rate, now)` in `packages/shared`, and the tests are written against the constant. Recommendation:
  `fetchedAt`. The original FR-11 ties the age to the provider not answering, and `fetchedAt` is the age of our copy:
  it warns when refreshing is failing, whereas the provider time of the oficial and tarjeta quotes is routinely a day
  old (weekends, holidays) and would raise the warning permanently, and the end-to-end fake provider has a fixed
  provider time that would always warn. The cost is that it does not show how old the quote itself is.
- **Q2 (open, human): archived accounts and categories.** The PRD says archiving hides an account or category from
  pickers (02a, 02b) but is silent on whether the API refuses a movement on an archived one. The spec adds no server-side
  check (no new requirement); the pickers of the web screen hide archived items. Recommendation: also refuse on the
  server, with the existing `ACCOUNT_ARCHIVED` (409, but with its own message, because the current wording says "this
  setting cannot be changed") and a new `CATEGORY_ARCHIVED`, plus one more AC each; the cost is two more error paths.
- **D1, automatic rate resolved on the server.** The create request carries `rate: { source: 'automatic' }` or
  `rate: { source: 'manual', value }`. For `automatic` the server reads the latest stored sell price of the user's
  default rate type at save time and freezes it, so the label "automatic: <rate type>" is never a client claim. The web
  sends `automatic` only while the rate field has never been edited by the user (a dirty flag, not equality: typing the
  prefilled value again is a manual rate). If a refresh lands between the form opening and the save, the frozen value is the
  newer one; the response returns it and the screen shows the saved rate after saving.
- **D2, calendar date.** AGENTS.md says dates are stored in UTC; that rule is about instants (`created_at` is
  `timestamptz`). A movement's date is a calendar day the user chose (`occurred_on date`), compared with "today" in the
  user's time zone (`todayInTimeZone`, a new shared helper that falls back to the default zone for an unknown stored zone).
  Ordering is `occurred_on` descending, then `created_at` descending, then `id` descending. The web never builds a `Date`
  from `YYYY-MM-DD` (it would shift a day at UTC-3); it formats the date parts.
- **D3, limits not in the PRD:** amount at most 10^15 minor units (as the opening balance of DISC-001-02a; account balances stay
  exact strings of up to 40 digits), note at most 500 characters after trimming, no control characters, and a note that is empty
  after trimming is stored as `null`. Listed in the parent index as added while planning, with D1, D4 and the read route.
- **D4, new error codes:** `MOVEMENT_DATE_IN_FUTURE` (400), `RATE_REQUIRED` (400, because the client can fix it by sending a
  manual rate), `MOVEMENT_CATEGORY_KIND_MISMATCH` (400); an account or category of another user, or an unknown id, answers
  `NOT_FOUND` (404). `GET /movements/:id` is added so that AC-16 can be tested on a single movement.
- **D5, the movement type equals the category kind** and the database enforces it with the composite foreign key
  `(category_id, owner_id, type) -> categories (id, owner_id, kind)`; the account owner is enforced the same way with
  `(account_id, owner_id) -> accounts (id, owner_id)`, which needs a new unique constraint on accounts. Transfers and currency
  exchanges (DISC-001-03c) have two accounts and no category, so that ticket's migration will relax `category_id` and the type
  check; this is a planned change, not a surprise.
- **D6, user deletion:** the keys to accounts and categories stay `ON DELETE RESTRICT` (human decision, 2026-10-02). Deleting a user row
  with accounts, categories and movements present depends on the order in which PostgreSQL fires the cascade triggers (their names
  embed OIDs), so the spec does not rely on the cascade from `movements` to `users` (kept only because the erasure guard requires it).
  `DrizzleUserDeletionRepository.erase` takes `select ... from users where id = $1 for update` after the outbox delete (the existing lock
  order: outbox first, user second), so a concurrent movement insert, which needs `FOR KEY SHARE` on the user, accounts and categories
  rows, waits and then fails on the foreign key after the user is gone; then the erasure step deletes the user's movements; then the
  `users` row is deleted. The tests assert the deterministic facts (with the step the deletion always succeeds; the race ends cleanly)
  and record the order-dependent outcome without pinning an OID-ordered result.
- **D7, module boundaries:** a single file `infrastructure/db/foreign-relations.ts` re-exports the relations of `users`, `accounts`,
  `categories` and `exchange_rates` from the owning modules' persistence files; it is the only movements file that imports another module,
  and only `infrastructure/db` files import it. The real adapters are typed with `import type` from the port files of accounts and
  categories (not from their barrels). ESLint forbids identity, accounts and categories from importing movements.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 3, Block 5, Block 8 |
| FR-02 | Block 1, Block 2, Block 3, Block 5, Block 8 |
| FR-03 | Block 1, Block 2, Block 3 |
| FR-04 | Block 2, Block 8 |
| FR-05 | Block 1, Block 2, Block 8 |
| FR-06 | Block 3, Block 7 |
| FR-07 | Block 4, Block 7 |
| FR-08 | Block 3, Block 5, Block 9 |
| FR-09 | Block 1, Block 2 |
| FR-10 | Block 3, Block 5 |
| FR-11 | Block 1, Block 8 |
| FR-12 | Block 4, Block 7 |
| FR-13 | Block 6 |
| FR-14 | Block 7 |
| NFR-01 | Strategy: bigint columns, int64 strings on the wire, no `Number` on money; a static scan test and a schema-introspection test (Blocks 1, 3, 10) |
| NFR-02 | Strategy: `rate` is a bigint column with a range check and `parseScaledRate` is the only text-to-rate conversion; the introspection test asserts no float column (Blocks 1, 3) |
| NFR-03 | Strategy: one insert plus four indexed point reads (account, category, user preferences, rate) in a single request with no external call; a performance test asserts p95 under 300 ms with the same sample size and warm-up as the accounts performance test (Block 7) |
| NFR-04 | Strategy: the query schema caps `limit` at 100 and the repository applies offset and limit with a count; tested at 100 and 101 (Blocks 1, 3, 5) |
| NFR-05 | Strategy: the module has no provider port and reads the stored rates only; a scan test asserts that no file of the module imports the exchange-rates provider, the sync job or the exchange-rates barrel, and only the foreign-relations file imports the rates relation (Blocks 2, 4, 10) |
| NFR-06 | Strategy: the real `AccountMovements` adapter is one `GROUP BY account_id` query over the `movements_account_idx` index in sequential chunks of at most 500 ids; the accounts performance test is re-run against it with 100 accounts and 100,000 movements (Block 7) |
| NFR-07 | Strategy: the repository applies `scopedTo(scope, { owner })` in the same statement on every read, the owner is forced from the session and the composite foreign key to accounts repeats the check in the database; the only unscoped code is the pair of real adapters, which the accounts and categories modules call with ids returned by their own scoped repositories (the ports document it) and whose results are keyed by the given ids; evidence is AC-16 and AC-17 plus the other-owner tests of Blocks 3, 4 and 5 (Blocks 3, 4, 5) |

## Dependencies between blocks
Block 1 (shared contracts and helpers) first. Block 2 (domain, ports, use cases) needs Block 1. Block 3 (persistence, migration 0013,
repository) needs Blocks 1 and 2. Block 4 (lookups, real adapters, foreign relations) needs Block 3. Block 5 (HTTP and composition) needs Blocks 2, 3 and 4.
Block 6 (erasure step, guard, lint) needs Block 3 and can run in parallel with Block 5. Block 7 (obligations of DISC-001-02a and 02b, totals, performance) needs Blocks 4 and 5.
Block 8 (web client and entry screen) needs Blocks 1 and 5. Block 9 (web list screen and navigation) needs Block 8. Block 10 (end-to-end flow and cross-cutting scans) is last.
Execution order: 1, 2, 3, 4, then 5 and 6, then 7 and 8, then 9, then 10.

## Block 1 — Shared contracts and helpers

**Files**
- `packages/shared/src/movements/movement.ts` (new) — movement type list, create request, list query, response and list response, constants.
- `packages/shared/src/movements/rate-age.ts` (new) — `RATE_AGE_BASIS`, `RATE_AGE_WARNING_MS` (2 hours), `rateAgeMs`.
- `packages/shared/src/movements/rate-input.ts` (new) — `parseRateInput(text, locale)` and `formatRateInput(value, locale)` for the entry screen, built on `parseScaledRate`; outside the `exchange-rates` directory on purpose, because the no-float scan of ticket 03a covers that directory.
- `packages/shared/src/time/today.ts` (new) — `todayInTimeZone(now, timeZone)` returning `YYYY-MM-DD`.
- `packages/shared/src/errors.ts` (modified) — adds `MOVEMENT_DATE_IN_FUTURE`, `RATE_REQUIRED`, `MOVEMENT_CATEGORY_KIND_MISMATCH` to `ERROR_CODES`.
- `packages/shared/src/index.ts` (modified) — exports the new files.
- `packages/shared/test/movement-schemas.test.ts`, `packages/shared/test/rate-age.test.ts`, `packages/shared/test/today.test.ts`, `packages/shared/test/rate-input.test.ts` (new).

**Logic**
`MOVEMENT_TYPES = ['expense', 'income']`. The create request is `{ type, accountId, categoryId, amount, date, note?, rate }`
where `amount` is a positive minor-units string (`1..10^15`), `date` is `YYYY-MM-DD` and a real calendar date, `note` is
trimmed (empty after trimming becomes absent), at most 500 characters without control characters, and `rate` is `{ source: 'automatic' }` or
`{ source: 'manual', value }` with `value` a scaled-rate string (`1..RATE_MAX_SCALED`). The response carries `id`, `type`,
`accountId`, `categoryId`, `amount`, `date`, `note` (or `null`), `rate` (scaled string), `rateSource` (`automatic` or
`manual`), `rateType` (a rate type or `null`) and `createdAt`. The list query is `limit` (1 to 100, default 50) and `offset`
(default 0) with the same `queryInteger` rule as accounts. `todayInTimeZone` formats the instant in the given IANA zone
with `Intl.DateTimeFormat` parts, never uses floating point, and falls back to `America/Argentina/Buenos_Aires` for an unknown zone
instead of throwing. `rateAgeMs(rate, now)` returns `now` minus the timestamp named by `RATE_AGE_BASIS`. `parseRateInput` reads a
user-typed rate in the locale's notation with up to 4 decimals into the scaled bigint (or `null`) and `formatRateInput` is its inverse;
neither uses `Number`, `parseFloat` or `Math` rounding.

**Input validation**
Amount: integer string, positive, at most 10^15. Date: strict `YYYY-MM-DD`, a real date (no 2026-02-30), year 1970 to 2100. Note: at most 500 characters, no
control or format characters. Rate value: plain decimal digits within the scaled range. `limit` 1 to 100 and `offset` at least 0, both rejected when blank. `accountId` and `categoryId`
are UUIDs; `type` is one of the two values; unknown keys are stripped.

**Error handling**
- A request that violates any rule above fails the schema with the field path listed and never the value.
- `parseRateInput` returns `null` for text that is malformed, has more than 4 decimals, is zero or exceeds the maximum; it never throws.

**Required tests**
- [ ] the create schema accepts an expense and an income with an automatic and with a manual rate — validates AC-01, AC-04, AC-08
- [ ] amount 0, a negative amount, a decimal string and an amount above 10^15 are rejected (invalid input) — validates AC-02
- [ ] a manual rate of 0 or below, a non-numeric rate and a rate above the maximum are rejected (invalid input) — validates AC-09
- [ ] an impossible date, a malformed date and a note of 501 characters are rejected (invalid input) — error path
- [ ] the list query defaults to limit 50 and offset 0, accepts 100 and rejects 101, 0 and a blank limit — validates AC-14
- [ ] `todayInTimeZone` returns the local calendar day around midnight for America/Argentina/Buenos_Aires and for a zone ahead of UTC, and an unknown zone falls back instead of an error — validates AC-15
- [ ] `rateAgeMs` uses the timestamp named by `RATE_AGE_BASIS` and a rate older than `RATE_AGE_WARNING_MS` is flagged — validates AC-11
- [ ] `parseRateInput` and `formatRateInput` round-trip `1623,3` (es) and `1623.3` (en) to `16233000n`, and `parseRateInput` returns null for malformed text and more than 4 decimals (invalid) — validates AC-08
- [ ] the three new error codes are in `ERROR_CODES` — validates AC-15, AC-21

**Completion criterion**
The shared tests pass, `pnpm typecheck` passes and `@pesly/shared` exports the movement schemas, `todayInTimeZone`, `rateAgeMs`
and the rate input helpers.

## Block 2 — Domain, ports and use cases

**Files**
- `apps/api/src/movements/domain/movement.ts` (new) — `Movement`, `NewMovement`, rate source value.
- `apps/api/src/movements/domain/errors.ts` (new) — `MovementDateInFuture`, `RateRequired`, `MovementCategoryKindMismatch` (extend `AppError`).
- `apps/api/src/movements/application/ports/movement-repository.ts`, `ports/account-lookup.ts`, `ports/category-lookup.ts`, `ports/rate-lookup.ts`, `ports/user-preferences.ts`, `ports/clock.ts` (new).
- `apps/api/src/movements/application/create-movement.ts`, `list-movements.ts`, `get-movement.ts` (new).
- `apps/api/test/movements/fakes.ts`, `create-movement.test.ts`, `list-and-get-movement.test.ts` (new).

**Logic**
`CreateMovement.execute(scope, input)`: (1) read the user's preferences (`timeZone`, `defaultRateType`); (2) reject a date after `todayInTimeZone(clock.now(), timeZone)` with
`MovementDateInFuture`; (3) find the account in the caller's scope (a missing or foreign one is a 404 through `ResourceNotFound`); (4) find the category in the scope, reject
`MovementCategoryKindMismatch` when its kind differs from the type; (5) resolve the rate: for `manual` use the typed value, for `automatic` read
`RateLookup.latestSell(defaultRateType)` and throw `RateRequired` when none is stored; (6) insert the row with the owner taken from the scope and return it. Archived
accounts and categories are not checked here (open question Q2). `ListMovements` returns `{ items, total }` for the scope, newest first, with limit and offset
re-validated. `GetMovement` returns one row of the scope or a 404. No use case imports a provider, a job or an adapter.

**Input validation**
Use cases receive values already parsed by the shared schemas; they re-check the date against today, the category kind against the type and the presence of a rate, and re-validate
`limit` and `offset` as `ListAccounts` does.

**Error handling**
- Date after today in the user's zone: `MovementDateInFuture`, nothing stored.
- Category of the other kind: `MovementCategoryKindMismatch`, nothing stored.
- `automatic` with no stored rate: `RateRequired`, nothing stored.
- An account or category of another user or an unknown id: `NOT_FOUND`, nothing stored and no difference between the two cases.

**Required tests**
- [ ] a valid expense and a valid income are stored with the owner of the scope and returned — validates AC-01, AC-04
- [ ] an expense in an income category and an income in an expense category fail with `MovementCategoryKindMismatch` and store nothing (reject) — validates AC-03, AC-05
- [ ] an automatic rate freezes the stored sell price of the user's default rate type with source `automatic` and that type — validates AC-06, AC-07
- [ ] a manual rate is stored with source `manual` and no rate type — validates AC-08
- [ ] an automatic rate with no stored rate fails with `RateRequired` (reject), and a manual rate in the same situation is accepted — validates AC-20, AC-21
- [ ] a date after today in the user's zone fails with `MovementDateInFuture` (reject), and today in a zone behind UTC is accepted while the UTC day is already tomorrow — validates AC-15
- [ ] an account or a category of another user fails as not found (404) and nothing is stored — validates AC-16
- [ ] listing returns only the scope's movements, newest first, with a stable order for equal dates, and `get` of a foreign id is not found (404) — validates AC-14, AC-16, AC-17
- [ ] no use case or port of the module depends on a provider (constructor keys) — validates NFR-05

**Completion criterion**
The listed tests pass against the in-memory fakes; `domain` and `application` import nothing from `infrastructure` (the architecture lint passes) and the scan of Block 10 shows no `drizzle-orm`, `pg`, `express` or `node:*` import in them.

## Block 3 — Persistence: relation, migration 0013 and the repository

**Files**
- `apps/api/src/movements/infrastructure/db/schema.ts` (new) — the `movements` relation, declared with the relations of `foreign-relations.ts` (Block 4) as foreign-key targets.
- `apps/api/drizzle/0013_movements.sql` (new, generated), `apps/api/drizzle/meta/0013_snapshot.json` (new), `apps/api/drizzle/meta/_journal.json` (modified, idx 13), `apps/api/drizzle/rollback/0013_movements.down.sql` (new).
- `apps/api/src/accounts/infrastructure/db/schema.ts` (modified) — the unique constraint `accounts_id_owner_unique (id, owner_id)`.
- `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts` (new).
- `apps/api/src/movements/infrastructure/system-clock.ts` (new).
- `apps/api/test/movements/movement-repository.test.ts`, `schema-introspection.test.ts` (new).
- `apps/api/test/identity/migration.test.ts` (modified) — `ALL_MIGRATIONS` 12 becomes 13; `ALL_TABLES` gains `movements` and so do the derived lists that must exclude it (`TABLES_WITHOUT_EXCHANGE_RATES`, `TABLES_BEFORE_0009`, `TABLES_WITHOUT_ACCOUNTS_AND_CATEGORIES`); the 22 chain starts that roll back 0012 get `rollback('0013_movements')` in front; the 18 `ALL_MIGRATIONS - n` offsets become `n + 1`; the journal filters of the 0009 and 0010 checks also exclude 0013; a new `describe` for 0013.
- `apps/api/test/deploy/build-output.test.ts` (modified) — its own list of tables gains `movements`.

**Data model**
- `movements`: `id uuid primary key default gen_random_uuid()`; `owner_id uuid not null` foreign key to `users` `ON DELETE CASCADE`; `type text not null` check in (`expense`, `income`); `account_id uuid not null`; `category_id uuid not null`;
  `amount bigint not null` check `between 1 and 1000000000000000`; `occurred_on date not null`; `note text null` check `char_length(note) <= 500`; `rate bigint not null` check `between 1 and 100000000000`;
  `rate_source text not null` check in (`automatic`, `manual`); `rate_type text null` check in the 7 rate types; check `(rate_source = 'automatic') = (rate_type is not null)`; `created_at` and `updated_at timestamptz not null default now()`.
- Foreign keys: `movements_account_owner_fk (account_id, owner_id) -> accounts (id, owner_id) ON DELETE RESTRICT`; `movements_category_owner_kind_fk (category_id, owner_id, type) -> categories (id, owner_id, kind) ON DELETE RESTRICT`.
- Indexes: `movements_owner_date_idx (owner_id, occurred_on desc, created_at desc, id desc)` for the list, `movements_account_idx (account_id)` and `movements_category_idx (category_id)` for the adapters and the restrict checks.
- Constraint added to `accounts`: `accounts_id_owner_unique unique (id, owner_id)` (the target of the composite key); no column changes.
- No float, real, double or numeric column; no foreign key to `exchange_rates` (the rate is frozen, never joined).
- Migration `0013_movements` creates the relation, its checks, keys and indexes and adds the unique constraint on `accounts`; it is non-destructive. `drizzle-kit generate` computes the next index from the last journal entry, so it names the files `0013_*` itself; CODE checks that the generated snapshot chains onto 0012's and that a second `drizzle-kit generate` reports no changes, and runs `drizzle-kit check`. Its journal `when` is the real generation time and must be greater than that of every earlier entry on `main` (0012 is
  1790945403578) and than the `when` of any open branch's migration (07a's 0008 is 1790962588595), re-checked at merge; tests assert order relative to known predecessors and never that 0013 is the newest, so the next migration cannot break them.
- Rollback `0013_movements.down.sql`: `ALTER TABLE IF EXISTS accounts DROP CONSTRAINT IF EXISTS`, `DROP TABLE IF EXISTS` for the relation (the migration tests re-run rollbacks after `accounts` is already gone), then deletes its row from `drizzle.__drizzle_migrations` by `when`; destructive (every movement is lost, so it requires a backup, a stopped API and worker, and runs before the rollback of any older migration).

**Logic**
The repository inserts with the owner forced from the scope, lists with `scopedTo(scope, { owner })` ordered `occurred_on desc, created_at desc, id desc` with offset, limit and a count, and reads one row in scope. Dates travel as `YYYY-MM-DD` strings
(`date` mode string), amounts and rates as bigint. An insert maps a foreign-key violation by constraint name with `violatedConstraint`: the account or category keys become a not-found error, a violation of the key to `users` is rethrown. A note that is empty after trimming is stored as `null`.

**Error handling**
- A foreign-key violation on insert (an account or category that vanished between the read and the insert) surfaces as a not-found error, never as a 500 with SQL.
- A check or unique violation cannot come from validated input; it is rethrown as a programming error.
- A database outage rejects the call; the use case rethrows it.

**Required tests**
- [ ] insert, list and get round-trip an expense and an income with exact bigint amounts and rates and a calendar date returned as a string — validates AC-01, AC-04, AC-06
- [ ] the list orders by date, then creation time, then id, and pages by 100 with a total — validates AC-14
- [ ] another owner's rows are never returned by list or get — validates AC-17
- [ ] the database rejects an amount of 0, a rate of 0, a rate above the maximum, an unknown type, a note of 501 characters and an automatic rate without a type (check violations) — error path
- [ ] the composite keys reject a movement whose account belongs to another owner and a movement whose category kind differs from its type (foreign-key violation) — validates AC-03, AC-05, AC-16
- [ ] an insert for an account that was deleted between the read and the insert fails as not found, not as a 500 (forced with a deleted account id) — error path
- [ ] deleting an account or a category that has a movement fails with a foreign-key violation and keeps the rows (restrict) — validates AC-18, AC-19
- [ ] introspection: no float or numeric column, the three foreign keys exist with the expected actions, the foreign key to users cascades, and no key to `exchange_rates` — validates NFR-01, NFR-02
- [ ] migration test: 0013 applies on 0012, its rollback restores 0012 with accounts intact and can run twice without error, and its `when` is greater than that of 0012 and of every earlier entry (no "newest" claim) — validates NFR-01

**Completion criterion**
Repository, introspection and migration tests pass against the migrated test database; `drizzle-kit check` is clean and a second `drizzle-kit generate` reports no changes; `migration.test.ts` and `build-output.test.ts` count the new relation and migration (13) and every rollback chain starts with 0013.

## Block 4 — Lookups, the real adapters and the foreign relations

**Files**
- `apps/api/src/movements/infrastructure/db/foreign-relations.ts` (new) — re-exports `users`, `accounts`, `categories` and `exchangeRates` from the owning modules' persistence files; the only file of the module that imports another module, and only `infrastructure/db` files import it.
- `apps/api/src/movements/infrastructure/db/drizzle-account-lookup.ts`, `drizzle-category-lookup.ts`, `drizzle-rate-lookup.ts`, `drizzle-user-preferences.ts` (new).
- `apps/api/src/movements/infrastructure/accounts/drizzle-account-movements.ts` (new) — the real `AccountMovements`, typed with `import type` from `apps/api/src/accounts/application/ports/account-movements.ts`.
- `apps/api/src/movements/infrastructure/categories/drizzle-category-usage.ts` (new) — the real `CategoryUsage`, typed with `import type` from `apps/api/src/categories/application/ports/category-usage.ts`.
- `apps/api/test/movements/lookups.test.ts`, `real-adapters.test.ts` (new).

**Logic**
`DrizzleAccountMovements.sumsByAccount(ids)` returns an empty map for an empty list, otherwise runs, in sequential chunks of at most 500 ids, `select account_id, sum(case type when 'income' then amount else -amount end) ... group by account_id` and returns exact bigint sums (cast to text, then `BigInt`); `hasMovements` is an `exists`.
`DrizzleCategoryUsage.isUsed` is an `exists` on `category_id`. Both are unscoped by design and keyed only by the ids they are given. `DrizzleRateLookup.latestSell(type)` reads the sell price (and both timestamps) of the `exchange_rates` row, or null.
`DrizzleUserPreferences.find(userId)` reads `time_zone` and `default_rate_type` from the caller's `users` row, validating the zone with `isIanaTimeZone` and falling back to the default zone; a missing user fails closed. The account and category lookups read id, owner, kind and archived state inside the scope.

**Error handling**
- A failing database call rejects and the use case rethrows it; no balance is guessed.
- A preferences read for a user that does not exist fails closed with an error, never with defaults.

**Required tests**
- [ ] `sumsByAccount` returns income minus expense per account, omits accounts without movements, returns an empty map for no ids and handles more than 500 ids — validates AC-12, AC-13
- [ ] `sumsByAccount` ignores movements of accounts that were not asked for and of other users — validates NFR-07
- [ ] `hasMovements` and `isUsed` are true after the first movement and false before — validates AC-18, AC-19
- [ ] the rate lookup returns the stored sell price and null when nothing is stored, and the preference lookup returns the stored zone and rate type and an error for a missing user (fail closed) — validates AC-07, AC-20
- [ ] the account and category lookups return only rows of the scope and report the archived state; another owner's id is not found (404 path) — validates AC-16
- [ ] an invalid stored time zone falls back to the default zone instead of an error — error path

**Completion criterion**
The lookup and adapter tests pass against the migrated test database and the ports of accounts and categories are satisfied by the new adapters (`pnpm typecheck`).

## Block 5 — HTTP and composition

**Files**
- `apps/api/src/movements/infrastructure/http/movement-routes.ts`, `movement-presenter.ts` (new).
- `apps/api/src/movements/index.ts` (new) — barrel: `createMovementRoutes`, `createAccountMovements`, `createCategoryUsage`, `eraseUserMovements`.
- `apps/api/src/shared/http/error-handler.ts` (modified) — status mapping for the three new codes.
- `apps/api/src/server.ts` (modified) — mounts the route and injects the real adapters.
- `apps/api/test/movements/movement-routes.test.ts` (new); `apps/api/test/foundation/error-handler.test.ts` (modified, three more routes).

**API contract**
- `POST /movements` — request body `{ type, accountId, categoryId, amount, date, note?, rate }` (Block 1); response 201 with the movement; errors: 400 `VALIDATION_FAILED` (with field paths), 400 `MOVEMENT_DATE_IN_FUTURE`, 400 `RATE_REQUIRED`, 400 `MOVEMENT_CATEGORY_KIND_MISMATCH`, 401 `UNAUTHENTICATED`, 403 `EMAIL_NOT_VERIFIED`, 404 `NOT_FOUND` (account or category not the caller's, or unknown).
- `GET /movements` — query `limit` (1 to 100, default 50) and `offset`; response 200 `{ items, total, limit, offset }` of the caller's movements, newest first; errors: 400 `VALIDATION_FAILED`, 401, 403.
- `GET /movements/:id` — params `id` (UUID); response 200 with the movement; errors: 400 `VALIDATION_FAILED`, 401, 403, 404 `NOT_FOUND` (another user's movement answers exactly like a missing one).
- Auth: `requireSession` then `requireVerifiedEmail` on the `/movements` prefix; the owner always comes from the session.

**Logic**
The factory builds the repository, the lookups and the use cases with the `OwnerOrGroupMemberAccessPolicy` and `DenyAllGroupMembershipReader` as the accounts routes do, with write scope for create and read scope for list and get. Audit log lines carry the request id, user id and movement id only, never the amount, note or rate.
`server.ts` passes `movements: createAccountMovements(db)` to `createAccountRoutes` and `usage: createCategoryUsage(db)` to `createCategoryRoutes`. The presenter is the only place where bigint becomes a string and a date becomes `YYYY-MM-DD` or ISO.

**Input validation**
Params, query and body go through the shared Zod schemas of Block 1 with the shared `validate` middleware; unknown keys are stripped; the response is validated by the shared response schemas.

**Error handling**
- Every failure answers `{ code }` (plus `fields` for validation) through the shared error handler; no SQL or stack reaches the body.
- The three new domain errors map to 400 as listed; an unknown or foreign account, category or movement is 404.

**Required tests**
- [ ] a verified user creates an expense and an income and both appear in the list newest first — validates AC-01, AC-04, AC-14
- [ ] an amount of 0 answers 400 `VALIDATION_FAILED` naming `body.amount` and stores nothing — validates AC-02
- [ ] an expense with an income category and an income with an expense category answer 400 `MOVEMENT_CATEGORY_KIND_MISMATCH` — validates AC-03, AC-05
- [ ] the stored rate and its source are returned: automatic with the default rate type's sell price, and manual with the typed value — validates AC-06, AC-08
- [ ] a manual rate of 0 answers 400 `VALIDATION_FAILED` — validates AC-09
- [ ] with no stored rate an automatic rate answers 400 `RATE_REQUIRED` and a manual one is accepted — validates AC-20, AC-21
- [ ] a refresh of the stored rates after saving leaves the saved movement's rate unchanged — validates AC-10
- [ ] a date after today in the user's zone answers 400 `MOVEMENT_DATE_IN_FUTURE` — validates AC-15
- [ ] another user's account, category or movement answers 404 `NOT_FOUND` and changes nothing; the list shows only the caller's movements — validates AC-16, AC-17
- [ ] the list pages by 50 by default, accepts 100 and rejects 101 with 400 — validates AC-14
- [ ] every route answers 401 without a session and 403 without a verified email, and a state-changing request without the origin headers answers 403 — error path
- [ ] a database failure answers 500 `INTERNAL` with only `{ code }` — error path
- [ ] the error handler maps each new code to its status (400) — error path

**Completion criterion**
Route and error-handler tests pass; the three routes are mounted by `server.ts` behind `requireSession` and `requireVerifiedEmail`; the accounts and categories routes receive the real adapters; the existing accounts and categories suites pass unchanged.

## Block 6 — Ordered erasure step, the erasure guard and the import rule

**Files**
- `apps/api/src/identity/infrastructure/db/user-erasure-step.ts` (new) — `UserErasureStep = (tx: IdentityDb, userId: string) => Promise<void>`.
- `apps/api/src/identity/infrastructure/db/drizzle-user-deletion-repository.ts` (modified) — locks the user row, then runs the steps, in order, after the outbox delete and the grant check and before the `users` delete, in the same transaction.
- `apps/api/src/identity/index.ts` (modified, exports `UserErasureStep` and accepts `beforeUserErased`), `apps/api/src/app.ts` (modified, forwards it by hand like `onUserCreated`).
- `apps/api/src/movements/infrastructure/db/erase-user-movements.ts` (new) — `eraseUserMovements(tx, userId)`, typed with its own structural database alias (as `SeedDatabase` does for categories) and not with `IdentityDb`; it deletes the user's rows from `movements`.
- `apps/api/src/server.ts` (modified) — `identity: { db, onUserCreated: [...], beforeUserErased: [eraseUserMovements] }`.
- `apps/api/test/helpers/identity-harness.ts` (modified) — forwards `beforeUserErased`.
- `apps/api/test/identity/user-erasure.test.ts` (modified) — the policy `erase-step` and a registry entry for the movements.
- `apps/api/test/identity/deletion-persistence.test.ts` (modified) — it builds the repository directly, so the step order and rollback tests live here.
- `eslint.config.mjs` (modified) — a `MOVEMENTS_IMPORTS` pattern forbidden in identity, accounts and categories, like `CATEGORIES_IMPORTS`.
- `apps/api/test/foundation/architecture-boundaries.test.ts` (modified) — probes for the new import rule.
- `apps/api/test/movements/erasure-step.test.ts` (new).

**Logic**
The repository receives `steps: readonly UserErasureStep[]` (default none, so existing callers keep working). Inside the existing transaction, after the outbox delete and the grant check, it takes
`select id from users where id = $1 for update` (lock order unchanged: outbox first, user second), runs each step with the transaction handle, then deletes the user. A concurrent movement insert waits on the user row and fails cleanly after the user is gone.
A step that throws aborts and rolls back the whole deletion (the user, the accounts and the movements all stay). Identity never imports movements: only the composition root wires the step, as with `seedDefaultCategories`, and ESLint forbids identity, accounts and categories from importing movements.
The guard test gains `ErasurePolicy = 'cascade' | 'erase-step'` with the allowed constraint names listed on the entry: a key that is not `ON DELETE CASCADE` is accepted only when it is one of the named constraints of a registered relation whose policy is `erase-step` (or a self-reference, as today), so a later accidental `RESTRICT` key on the same relation fails the guard.
The movements entry seeds a second account (not named `Caja`, which the accounts seeder already uses), a category and a movement for the user. The tests assert the deterministic facts and record what PostgreSQL does with a bare `delete from users` as an order-dependent fact without pinning an OID-ordered result.

**Error handling**
- A step that throws rolls back the whole deletion: the user, accounts and movements stay and the caller gets the existing error.
- A user with no movements runs the step as a no-op.
- A stale credentials version or an invalid grant still abort before any step runs.

**Required tests**
- [ ] deleting a user who has movements, accounts and categories through the real route leaves no row of that user in movements, accounts or categories and keeps another user's rows — validates AC-22
- [ ] a step that throws rolls back: the user, accounts and movements stay (error path) — validates AC-23
- [ ] a failing movements delete (a forced error) aborts the whole deletion with the user intact (error path) — validates AC-23
- [ ] a movement insert in flight while the user is erased ends cleanly: the deletion succeeds and no row of the user remains, or the insert fails on the foreign key (race) — validates AC-22
- [ ] the guard accepts the movements keys only as named constraints of a table registered with `erase-step`, and fails for another non-cascading key on that table and for a non-cascading key on an unregistered table (error probes) — validates AC-22
- [ ] a stale credentials version or an invalid grant aborts before the step runs (error path) — validates AC-23
- [ ] the repository tests that build it without steps keep passing, and the architecture probes reject an import of movements from identity, accounts and categories (error path) — validates AC-22

**Completion criterion**
The guard and erasure tests pass with the movements registered; the lint rule and its probes pass; the existing deletion suites pass unchanged.

## Block 7 — Obligations of DISC-001-02a and DISC-001-02b, totals and performance

**Files**
- `apps/api/test/movements/account-obligations.test.ts` (new) — the deferred end-to-end behavior of DISC-001-02a with real movements.
- `apps/api/test/movements/category-obligations.test.ts` (new) — the deferred behavior of DISC-001-02b with real movements.
- `apps/api/test/movements/totals.test.ts` (new) — FEAT-003 Available and Net worth totals with real movements.
- `apps/api/test/perf/movements-save.perf.test.ts` (new) — saving a movement.
- `apps/api/test/perf/accounts-list.perf.test.ts` (modified) — runs against the real adapter and the real relation instead of the test-only relation; its teardown deletes movements before accounts and users; the call counter wraps the real adapter.

**Logic**
These are integration tests over the real routes and adapters; no production code changes here. They cover: AC-10 of 02a end to end (an account with a real movement cannot be deleted: 409 `ACCOUNT_HAS_MOVEMENTS`, rows intact); the history half of AC-07 of 02a (archiving an account keeps its
movements visible in the list); the balance formula with real income and expense (opening balance plus movements, AC-11 of 02a); AC-05 and AC-06 of 02b (a renamed category shows its new name for existing movements through the categories route, and an archived category stays on its movements);
AC-10 of 02b end to end (a category used by a movement cannot be deleted: 409 `CATEGORY_IN_USE`); and the FEAT-003 totals, where Available and Net worth change by the movement amount for included and for non-included accounts.
The performance tests seed 100 accounts and 100,000 movements with `generate_series` (bound parameters), use the same sample size and warm-up as the accounts performance test, measure p95 of the account list and of saving a movement, and delete what they seeded.

**Error handling**
- Deleting an account or category with movements answers 409 and keeps every row.
- A second user's movements never change the caller's balances or totals.

**Required tests**
- [ ] an account with a real movement cannot be deleted: 409 `ACCOUNT_HAS_MOVEMENTS` and the account and movement remain — validates AC-18
- [ ] archiving an account keeps its movements in the list, and unarchiving restores it — validates FR-12
- [ ] a category used by a real movement cannot be deleted: 409 `CATEGORY_IN_USE`, and renaming or archiving it leaves the movement showing it — validates AC-19
- [ ] an expense of 100.00 on an included account lowers Available and Net worth by 100.00, an income raises both, and a movement on a non-included account changes only Net worth — validates AC-24, AC-12, AC-13
- [ ] the balance of an account equals its opening balance plus incomes minus expenses and ignores other users' movements — validates AC-12, AC-13
- [ ] deleting another user's account that has movements answers 404 and leaves everything unchanged (error path) — validates AC-16
- [ ] the account list with 100 accounts and 100,000 movements answers in under 300 ms at p95 — validates NFR-06
- [ ] saving a movement answers in under 300 ms at p95 — validates NFR-03

**Completion criterion**
The integration tests pass and the performance tests meet their thresholds on the real adapter; the deferred items of DISC-001-02a and DISC-001-02b listed in the parent index are each covered by a named test.

## Block 8 — Web client and the entry screen

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `createMovement`, `listMovements`, `getLatestRates`, new error keys and the mapping of the three new codes.
- `apps/web/src/features/movements/containers/create-movement-container.tsx` (new).
- `apps/web/src/features/movements/components/movement-form.tsx`, `rate-field.tsx` (new).
- `apps/web/src/features/movements/movement-form-errors.ts`, `format-rate.ts` (new).
- `apps/web/src/app/[locale]/(app)/movements/new/page.tsx` (new).
- `apps/web/messages/es.json`, `apps/web/messages/en.json` (modified) — the `movements` namespace for the entry screen and the new error messages (including a message for the three new codes that does not reuse the account-archived wording).
- `apps/web/test/movements-components.test.tsx`, `movements-containers.test.tsx`, `api-client.test.ts`, `i18n-catalogs.test.ts`, `routes.test.tsx` (new or modified).

**Logic**
The entry screen loads the active accounts, the non-archived categories of the chosen type (paging each list by 100), the profile preferences (default rate type, time zone) and the latest rates. The type switch (expense or income) filters the category picker. The date defaults to today in the user's time zone
(`todayInTimeZone`). The rate field is prefilled with the default rate type's sell price formatted by `formatRateInput`; when no rate is stored it is empty and required (AC-20); while the rate field has never been edited the request sends `rate: { source: 'automatic' }`,
otherwise `{ source: 'manual', value }` parsed by `parseRateInput`. While `rateAgeMs` is above `RATE_AGE_WARNING_MS` the screen shows "rate from N h ago" (AC-11). After saving, the screen shows the rate that was frozen and returns to the list. All strings come from the catalogs, amounts and rates use the locale formatters,
and colors and spacing come from theme tokens. Presentational components have no data fetching. The date is shown and parsed from its parts, never through `new Date('YYYY-MM-DD')`.

**Input validation**
The container validates before sending: the amount through `parseAmountInput` (positive, up to 2 decimals) with the message "Amount must be greater than 0" for zero or negative (AC-02), a required account and category, a date that is not after today, a manual rate through `parseRateInput`
(rejecting zero), and a note up to 500 characters. The first invalid field is focused and each field shows its own message; nothing is sent while a field is invalid.

**Error handling**
- A 401 redirects to sign in; `RATE_REQUIRED`, `MOVEMENT_DATE_IN_FUTURE` and `MOVEMENT_CATEGORY_KIND_MISMATCH` show their message on the right field; any other failure shows the generic message with a retry.
- When the latest rates cannot be loaded the screen still works with a required manual rate.

**Required tests**
- [ ] the entry screen prefills the rate from the default rate type's sell price and sends an automatic rate while the field was never edited — validates AC-06, AC-07
- [ ] editing the prefilled rate, even to the same value, sends a manual rate with the typed value, and a manual rate of 0 is rejected on the client with no request (invalid input) — validates AC-08, AC-09
- [ ] with no stored rate the rate field is empty and required, and saving without one is rejected with no request (invalid input) — validates AC-20, AC-21
- [ ] the age message shows "rate from 3 h ago" for a rate older than 2 hours and nothing for a fresh one, using the basis chosen in `RATE_AGE_BASIS` — validates AC-11
- [ ] an amount of 0 shows "Amount must be greater than 0" and sends nothing (invalid input) — validates AC-02
- [ ] choosing expense or income filters the category picker and hides archived categories — validates AC-03, AC-05
- [ ] the date field defaults to today in the user's time zone and a later date is rejected on the client (invalid input) — validates AC-15
- [ ] a 401 redirects to sign in and a server error shows the generic message with retry (error path) — validates AC-01
- [ ] the server codes `RATE_REQUIRED` and `MOVEMENT_DATE_IN_FUTURE` show their message on the field (error path) — validates AC-21, AC-15
- [ ] both catalogs have the same keys and the new error codes map to message keys — validates AC-15, AC-21

**Completion criterion**
Web tests pass, `pnpm typecheck` and `pnpm lint` pass, the Spanish and English catalogs have the same keys, and no hardcoded user-visible string exists in the new components.

## Block 9 — The movements list screen and navigation

**Files**
- `apps/web/src/features/movements/containers/movements-container.tsx` (new).
- `apps/web/src/features/movements/components/movement-list.tsx`, `movement-row.tsx`, `movements-load-state.tsx` (new).
- `apps/web/src/app/[locale]/(app)/movements/page.tsx` (new).
- `apps/web/src/features/auth/components/authenticated-shell.tsx` (modified) — a navigation link to the movements list.
- `apps/web/messages/es.json`, `apps/web/messages/en.json` (modified) — the list strings and the navigation label.
- `apps/web/test/movements-list.test.tsx`, `authenticated-shell-container.test.tsx`, `routes.test.tsx` (new or modified).

**Logic**
The list screen loads the first page of movements and the accounts and categories needed to name them: both the active and the archived accounts and categories (`archived=false` and `archived=true`, paging each by 100 until the total is reached), because a movement may sit on an archived account or category. It shows the date (formatted from its parts),
the category (default categories through `categoryLabel`) and account names, the amount with the account's currency and the rate used; "show more" loads the next page of at most 100. The navigation link has an icon and an `app.nav` label in both catalogs.

**Input validation**
The only input is the page offset sent by the "show more" control, which the container derives from the number of items already shown and the total.

**Error handling**
- A 401 redirects to sign in; any other failure while loading shows the generic message with a retry and keeps the rows already shown.
- A movement whose account or category is missing from the loaded sets shows a neutral placeholder name instead of failing.

**Required tests**
- [ ] the list shows movements newest first with names, amounts, currencies and rates, and a movement on an archived account and one on an archived category show their names — validates AC-01, AC-04, AC-14
- [ ] "show more" loads the next page of at most 100 and stops when the total is reached — validates AC-14
- [ ] a 401 redirects to sign in and a server error shows the generic message with retry and keeps the rows (error path) — validates AC-14
- [ ] a movement with an unknown account id shows a placeholder and does not fail (error path) — validates AC-14
- [ ] the navigation shows the movements link for the signed-in shell and the page is registered in the routes test — validates AC-14

**Completion criterion**
Web tests pass, `pnpm typecheck` and `pnpm lint` pass and the catalogs keep the same keys.

## Block 10 — End-to-end flow and cross-cutting scans

**Files**
- `apps/web/e2e/movements.spec.ts` (new); `apps/web/e2e/support/database.ts` (modified — exports `withE2eDatabase` and its `_e2e` guard, and adds helpers to delete or age the stored rates).
- `apps/api/test/movements/no-float-money.test.ts` (new), `apps/api/test/movements/request-path.test.ts` (new).
- `apps/api/test/foundation/architecture-boundaries.test.ts` (modified) — a movements block.
- `playwright.config.ts` (unchanged unless the flow needs another setting).

**Logic**
The end-to-end flow registers and verifies a user, creates an ARS account, records an expense and an income with the prefilled rate and one with a typed rate, checks the list order, the balance on the accounts screen, that the account cannot be deleted while it has movements, and the
rate-age message after the stored rates are aged in the database. The e2e worker already stores the fake rates, so the "no stored rate" case deletes the rate rows first (the next refresh is an hour away). The scans read source text only: the no-float scan covers `apps/api/src/movements`, `packages/shared/src/movements` and the web `format-rate.ts` for `parseFloat`, `Number(`,
`.toFixed`, `Math.round` and identifiers named exactly `amount`, `rate`, `buy` or `sell` annotated as numbers (the age helpers `rateAgeMs` and `RATE_AGE_WARNING_MS` measure time and are not flagged); the request-path scan asserts that no file of the module imports the exchange-rates provider, the sync job or the exchange-rates barrel, that only `foreign-relations.ts` imports another module's persistence file,
and that `domain` and `application` import no `drizzle-orm`, `pg`, `express` or `node:*`. The architecture block adds the movements domain and application probes.

**Input validation**
The end-to-end flow fills the entry screen with valid values, with an amount of 0 and with no stored rate, to see the field messages.

**Error handling**
- The flow fails on any console error or API status of 400 or above that it did not provoke on purpose.
- A failed scan names the file and the offending token.

**Required tests**
- [ ] the flow records an expense and an income, shows them newest first, shows the balance, and refuses to delete the account with movements (409 message) — validates AC-01, AC-04, AC-12, AC-13, AC-14, AC-18
- [ ] with no stored rate the entry screen requires a manual rate and saves it as manual (error path: saving without one is refused) — validates AC-20, AC-21
- [ ] after aging the stored rates in the database the screen shows the age message — validates AC-11
- [ ] the no-float scan passes on the module and fails on probe strings — validates NFR-01, NFR-02
- [ ] the request-path scan passes on the module and fails on probe strings importing the provider, the job, the barrel, or a foreign persistence file outside `foreign-relations.ts` (invalid import) — validates NFR-05
- [ ] the architecture probes reject an infrastructure import in domain and application — validates NFR-07
- [ ] the whole API, shared and web suites and the e2e suite pass with the new migration, relation, routes and screens — validates NFR-03

**Completion criterion**
`pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm e2e` pass; the migration count and journal checks include 0013.

## Final verification
- FR-01 to FR-05 and FR-08, FR-09: an expense and an income can be saved with a frozen rate and source and listed newest first, through the API and the web screens; no stored rate forces a manual one.
- FR-06 and FR-07: the stored rates can refresh without touching saved movements; the balances and totals count movements.
- FR-10: only the owner reads movements, with 404 otherwise.
- FR-11: the age message follows the confirmed basis (`RATE_AGE_BASIS`, open question Q1).
- FR-12: an account or category with movements cannot be deleted, enforced by the use cases and by the `RESTRICT` keys.
- FR-13: deleting a user locks the user, erases the user's movements first, in the same transaction, and the guard registers the policy.
- FR-14: Available and Net worth change with movements.
- NFR-01 to NFR-07: bigint everywhere, performance tests at 300 ms, 100-item pages, 0 provider calls, owner-scoped queries.
- Rollback: stop the API and the worker, run `apps/api/drizzle/rollback/0013_movements.down.sql` as a whole (destructive: all movements are lost) and revert the commits; accounts and categories keep working because the revert swaps the real adapters back to the empty ones.
- Open questions for the human before CODE: Q1 (rate age basis) and Q2 (archived accounts and categories).
