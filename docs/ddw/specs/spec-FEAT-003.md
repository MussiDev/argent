# Spec FEAT-003: Available balance vs net worth

| Field | Value |
|-------|-------|
| Ticket | FEAT-003 |
| PRD | docs/ddw/prd/prd-FEAT-003.md |
| Tier | FEATURE |
| Date | 2026-10-02 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
Amends the accounts module (spec DISC-001-02a). Every account gets a stored boolean `include_in_available`
whose default comes from its type (one shared function used by the API and the web form). The list
response replaces the single `totals` map with three exact per-currency maps: `availableTotals` (active
included accounts), `netWorthTotals` (all active accounts, the old `totals`) and `debtTotals` (active
credit card accounts). A new idempotent route `PUT /accounts/:id/include-in-available` changes the
setting; it refuses credit cards (400 naming the field), archived accounts (409 `ACCOUNT_ARCHIVED`) and
foreign accounts (404). Credit cards are stored as not included and a database CHECK forbids anything
else. Migration `0011` adds the column, backfills by type default and adds the CHECK. The web list shows
a headline (Available large, Net worth small, per currency), the non-card accounts, and a Debt section
with the cards and their per-currency total; each non-card active row carries an "include in available"
checkbox and the create form carries the same checkbox.

## Decisions recorded in this spec
- **API sections vs client grouping (decided in PLAN):** the list stays ONE flat paginated list of
  accounts, and the web groups the page by `type` (credit card vs the rest). The Debt total and the other
  totals are computed by the API over every active account, so they stay exact whatever the page holds.
  Reasons: (1) every item already carries `type`, so no new field or filter is needed; (2) the web asks for
  the API's maximum page (100) and has no pagination control, so a page holds every account of a personal
  user; (3) a separate `kind` filter or a second request would add API surface and a second round trip for
  no user-visible gain; (4) the PRD's pagination risk is covered because no total depends on the page.
  Revisit when PRD 03 or a pagination control introduces more than 100 accounts per view; the cheap
  escalation is a `kind` query parameter on the same endpoint.
- **Dedicated route instead of widening PATCH:** `PUT /accounts/:id/include-in-available` with body
  `{ includeInAvailable: boolean }` mirrors archive and unarchive (one use case per file, one audit line),
  leaves rename untouched, and gives the card and archived rules their own error paths. `PATCH` rejects
  `includeInAvailable` explicitly (like `type` and `currency`) so it is never silently ignored.
- **Error choices for the PRD's rules:** a card change answers 400 `VALIDATION_FAILED` with `fields`
  `["body.includeInAvailable"]`; an archived account answers 409 with the new code `ACCOUNT_ARCHIVED`. A
  card that is also archived answers the card error (checked first). To keep ONE central error mapping
  (arch audit finding), `AppError` gains an optional `fields` list and `mapError` emits it for any
  `AppError` that carries one; `HttpError` keeps working through the same property. The domain error
  `CreditCardSettingLocked` is an `AppError('VALIDATION_FAILED')` that declares the request field path
  `body.includeInAvailable` (the same `<part>.<path>` scheme `validate` uses); no route catches and
  rethrows.
- **Atomic classification (arch audit finding):** `setIncludeInAvailable` runs in one transaction: it
  reads the scoped row `FOR UPDATE`, classifies it (`not_found`, `credit_card`, `archived`), and only an
  active non-card row is updated, so there is no window between a failed update and a second read and no
  fourth state. The repository returns the classification union (instead of a bare row or null) because
  the refusal reason must come from the same locked read as the decision; the business rules themselves
  (card and archived) stay named in the use case, which maps each outcome to its domain error.
- **Idempotent like archive:** when the stored value already equals the requested one, the repository
  does not write and `updated_at` stays untouched, exactly as `setArchived` leaves its timestamps alone
  on a no-op.
- **Debt section visibility does not depend on the page (arch audit finding):** the list response also
  carries `creditCardCount`, the number of ACTIVE credit card accounts across all pages; the web shows the
  Debt section when it is above 0. Cards that fall beyond the first 100 accounts are not listed until a
  pagination control exists (accepted limitation, same revisit trigger as the flat list).
- **Backfill and default share one rule:** `defaultIncludeInAvailable(type)` is true for cash, bank
  account and digital wallet and false for savings and credit card. The migration hard-codes the same
  list in SQL; a test asserts that the SQL result equals the function for every type.
- **No default on the column:** after the backfill the column is `NOT NULL` with no default, so an insert
  that forgets the value fails loudly instead of silently choosing one.
- **Response rename:** `totals` becomes `netWorthTotals`. The web is the only consumer; all call sites are
  listed in the blocks.
- **Archived view:** unchanged: one flat list, no headline, no Debt section, no setting checkbox (archived
  accounts cannot change it, FR-06).
- **Debt total sign:** the Debt total is the plain sum of the balances of the active cards (negative when
  money is owed), formatted like any balance; Net worth already includes it with that sign.
- **Native checkbox as an owned `ui` component:** the setting control is
  `apps/web/src/components/ui/checkbox.tsx`, a native `<input type="checkbox">` styled with theme tokens
  (same pattern as the native `ui/select.tsx` of 02a), used by the account row and the create form so
  neither restyles it ad hoc. Reasoning: a Radix switch would add a runtime dependency; none is
  added. No new dependency in this ticket.
- **Migration number and journal:** `0011_account_include_in_available`; 0008 (07a), 0009 (02b) and 0010
  (01f) are reserved by open branches. The journal entry uses `idx` 11 so that `drizzle-kit generate`
  continues at 0012, and `when` 1790949600000 (2026-10-02T14:00Z), greater than every existing `when`
  (the maximum on main is 1790895423195, migration 0006). The snapshot `0011_snapshot.json` chains from
  `0007_snapshot.json`'s id; whichever branch merges later re-chains `prevId`. **Merge-order rule:** the drizzle migrator applies only
  journal entries whose `when` is above the highest `created_at` already stored, so 0008, 0009 and 0010
  must each carry a `when` above 1790949600000 (bump it when rebasing) or they would be silently skipped on
  any database that already ran 0011.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 2, Block 4 |
| FR-02 | Block 1, Block 5 |
| FR-03 | Block 1, Block 3, Block 7 |
| FR-04 | Block 1, Block 3, Block 4, Block 5, Block 7 |
| FR-05 | Block 1, Block 2, Block 3, Block 5 |
| FR-06 | Block 3, Block 4, Block 5, Block 6 |
| FR-07 | Block 3, Block 4, Block 5, Block 7 |
| FR-08 | Block 3, Block 5, Block 7 |
| FR-09 | Block 7 |
| FR-10 | Block 3, Block 5, Block 7 |
| FR-11 | Block 2 |
| FR-12 | Block 4, Block 5 |
| FR-13 | Block 6, Block 7 |
| NFR-01 | Strategy: totals use the existing exact `bigint` helpers (`addExact`, `sumExact`) and unbounded integer-string response schemas, so no sum can overflow; a test lists 9,300 accounts at 10^15 and checks all three totals (Block 8) |
| NFR-02 | Strategy: one `listActive` query (two extra columns) feeds all three totals and one batched movements port call; the existing 100,000-movement performance test asserts p95 under 300 ms with the new response (Block 8) |
| NFR-03 | Strategy: additive migration (nullable-free column added with a temporary default, backfilled in the same transaction, default dropped), plus a rollback script that drops the column and forgets the journal row; a migration test checks 0 rows without a value and the rollback (Block 2) |
| NFR-04 | Strategy: the new repository method takes an `AccessScope` and filters with `scopedRow`/`scopedTo` on the locked read that classifies the row and on the update in the same transaction (Block 4) |
| NFR-05 | Strategy: every new label lives in `messages/es.json` and `messages/en.json`; the existing catalog parity test fails on a missing key and a component test asserts the four labels in both locales (Block 6, Block 7) |

## Dependencies between blocks
Execution order: Block 1 → Block 2 → Block 3 → Block 4 → Block 5 → Block 6 → Block 7 → Block 8.
- Block 2 needs Block 1 only for the type list; it can be written once the shared default is fixed.
- Block 3 needs Block 1 (contracts, default function, error code) and defines the ports Block 4 implements.
- Block 4 needs Block 2 (the column) and Block 3 (the ports).
- Block 5 composes Blocks 3 and 4 and the existing session, verified-email, validation and access policy.
- Block 6 calls the contract fixed in Block 5; Block 7 uses Block 6.
- Block 8 runs against everything and needs all other blocks.

## Block 1 — Shared contracts, default and error code (packages/shared)

**Files**
- `packages/shared/src/accounts/account.ts` (modified) — `includeInAvailable` on create and response, `setIncludeInAvailableRequestSchema`, `defaultIncludeInAvailable`, `includeInAvailable: z.never().optional()` on the rename request, the three totals maps on the list response replacing `totals`.
- `packages/shared/src/errors.ts` (modified) — adds `ACCOUNT_ARCHIVED` to `ERROR_CODES`; `AppError` gains an optional `fields` list.
- `apps/api/test/shared/account-contracts.test.ts` (modified) — contract and default tests; the `totals` assertions become `netWorthTotals`.
- `apps/api/test/foundation/error-handler.test.ts` (modified) — the new code maps to 409.

**Logic**
`defaultIncludeInAvailable(type)` returns true for `cash`, `bank_account` and `digital_wallet`, false for `savings` and `credit_card`. `createAccountRequestSchema` gains `includeInAvailable: z.boolean().optional()` and a `superRefine` that adds an issue at path `includeInAvailable` when `type` is `credit_card` and the value is `true`. `setIncludeInAvailableRequestSchema = z.object({ includeInAvailable: z.boolean() })`. `accountResponseSchema` gains `includeInAvailable: z.boolean()`. `listAccountsResponseSchema` replaces `totals` by `availableTotals`, `netWorthTotals` and `debtTotals`, each `z.record(accountCurrencySchema, exactIntegerStringSchema)`, and adds `creditCardCount: z.number().int().min(0)`. `AppError`'s constructor takes an optional third argument `fields?: string[]`, stored as `readonly fields`. The refinement keeps the create contract a `ZodObject` (Zod 4), so `validate` still accepts it; the typecheck proves it.

**Input validation**
- `includeInAvailable` is an optional strict boolean on create (a string such as `"true"` is rejected, no coercion) and a required strict boolean on the setting route body.
- Unknown keys are stripped as everywhere else; `includeInAvailable` on the rename body fails with a `never` issue.
- A credit card created with `includeInAvailable: true` fails with the issue at `includeInAvailable`.

**Error handling**
- A non-boolean setting on create is a 400 validation failure naming `body.includeInAvailable`.
- A non-boolean or missing setting on the setting route is a 400 validation failure naming `body.includeInAvailable`.
- A credit card created as included is a 400 validation failure naming `body.includeInAvailable`.
- The rename body carrying `includeInAvailable` is a 400 validation failure.
- `ACCOUNT_ARCHIVED` maps to HTTP 409 in the error handler status table.

**Required tests**
- [ ] `defaultIncludeInAvailable` returns true for cash, bank account and digital wallet (validates AC-03).
- [ ] `defaultIncludeInAvailable` returns false for savings and credit card (validates AC-04, AC-09).
- [ ] the create schema keeps an explicit true or false for a non-card type (validates AC-05).
- [ ] the create schema rejects a non-boolean `includeInAvailable` with an invalid-type issue at `includeInAvailable` (validates AC-06).
- [ ] the setting schema rejects a missing and a non-boolean value as invalid (validates AC-08).
- [ ] the create schema fails a credit card with `includeInAvailable: true` and accepts it with false or omitted (error path, validates AC-10).
- [ ] the response schema requires `includeInAvailable` (validates AC-02).
- [ ] the list response schema requires `creditCardCount` as a non-negative integer and fails a negative or fractional value (error path, validates AC-19, AC-20).
- [ ] the rename schema rejects `includeInAvailable` as an invalid field (error path for FR-04).
- [ ] the error handler answers 409 for `ACCOUNT_ARCHIVED` (error path for FR-06).

**Completion criterion**
The listed shared and API tests pass, `pnpm typecheck` passes for `packages/shared` (callers of `totals` are fixed in later blocks, so the whole-repo typecheck is green again after Block 7).

## Block 2 — Migration 0011 and Drizzle schema

**Files**
- `apps/api/src/accounts/infrastructure/db/schema.ts` (modified) — adds the `include_in_available` column and the credit card CHECK.
- `apps/api/drizzle/0011_account_include_in_available.sql` (new) — hand-edited migration.
- `apps/api/drizzle/rollback/0011_account_include_in_available.down.sql` (new) — rollback script.
- `apps/api/drizzle/meta/_journal.json` (modified) — entry `idx` 11, tag `0011_account_include_in_available`, `when` 1790949600000.
- `apps/api/drizzle/meta/0011_snapshot.json` (new) — snapshot generated by drizzle-kit, `prevId` set to the id of `0007_snapshot.json`.
- `apps/api/test/identity/migration.test.ts` (modified) — migration count 8 becomes 9; every existing rollback sequence starts with `0011` first; the `insertAccount` helper passes the setting; new assertions.
- `apps/api/drizzle/rollback/0007_profile_display_name.down.sql` (modified) — its comment about being the newest migration is updated.

**Logic**
Run `pnpm --filter @pesly/api db:generate`, rename the generated files to the 0011 names and set the journal entry as above. Hand-edit the SQL to run in this order, inside the migrator's transaction: add the column `NOT NULL DEFAULT false`; `UPDATE accounts SET include_in_available = true WHERE type IN ('cash', 'bank_account', 'digital_wallet')`; drop the default; add `CONSTRAINT accounts_credit_card_not_available_check CHECK (type <> 'credit_card' OR include_in_available = false)`. In `migration.test.ts` each existing rollback sequence (which starts from the newest migration) is prefixed with the rollback of `0011`, because the drizzle migrator only applies journal entries whose `when` is above the highest stored `created_at`, so a leftover 0011 row would silently stop older migrations from re-applying; every `ALL_MIGRATIONS - N` expectation shifts by one and the comment that names 0006 as the newest is corrected. The raw `insert into accounts` helper (`insertAccount`) gains the new column. The rollback script drops the constraint and the column, then deletes the journal row whose `created_at` is 1790949600000, states that it is destructive (every user choice is lost) and says to run it before the rollback of any later migration.

**Data model**
- Entity `accounts`, new field `include_in_available boolean NOT NULL`, no default after the backfill, no index (it is only read together with the owner filter that already uses `accounts_owner_created_idx`).
- Constraint: `accounts_credit_card_not_available_check` CHECK as above; the existing type, currency and immutability constraints are untouched.
- Backfill: true for cash, bank account and digital wallet; false for savings and credit card.

**Error handling**
- An insert that omits the column fails with a NOT NULL violation (no silent default).
- An insert or update that marks a credit card as included fails with a check violation.
- A failure in any statement rolls the whole migration back, so 0 accounts are left without a value.

**Required tests**
- [ ] after the migration on a database with accounts of every type created before it, every row has the type default (validates AC-21, FR-11).
- [ ] the SQL backfill result equals `defaultIncludeInAvailable` for each of the five types (validates AC-21).
- [ ] inserting an account without the column must fail with a not-null violation (error path).
- [ ] updating a credit card to included must fail with a check violation, and inserting one as included must fail the same way (error path, validates AC-10, AC-11 at the database level).
- [ ] the column keeps its value across an archive and unarchive (validates AC-01).
- [ ] running the migration statements in one transaction with a forced failure at the last statement leaves no column and no changed row (error path, validates NFR-03).
- [ ] the rollback script removes the column and the journal row, and the migration can be applied again (validates NFR-03).
- [ ] the migration count is 9 and the `when` of the 0011 entry is strictly greater than the maximum `when` of the earlier entries (the 0007 entry is already lower than 0006's, so the check compares against the maximum, not every pair) (validates NFR-03).
- [ ] rolling back 0011 first and then each older migration in turn re-applies cleanly, for every existing rollback sequence; an account set to a non-default value before the rollback shows its type default after re-applying, which proves the backfill (validates NFR-03).

**Completion criterion**
`migration.test.ts` passes on an empty database and on one seeded before 0011, `pnpm --filter @pesly/api db:generate` reports no pending changes, and `pnpm typecheck` passes for `apps/api`.

## Block 3 — Domain, ports and use cases (accounts module, application layer)

**Files**
- `apps/api/src/accounts/domain/account.ts` (modified) — `includeInAvailable` on `Account`; the totals computation.
- `apps/api/src/accounts/domain/errors.ts` (modified) — `CreditCardSettingLocked` (a validation error that declares the field path) and `AccountArchived`.
- `apps/api/src/accounts/application/ports/account-repository.ts` (modified) — `CreateAccountData.includeInAvailable`, `ActiveAccount` gains `type` and `includeInAvailable`, new `setIncludeInAvailable`.
- `apps/api/src/accounts/application/create-account.ts` (modified) — applies the type default.
- `apps/api/src/accounts/application/list-accounts.ts` (modified) — three totals.
- `apps/api/src/accounts/application/set-include-in-available.ts` (new) — the new use case.
- `apps/api/src/accounts/index.ts` (modified) — exports the new use case.
- `apps/api/test/accounts/fakes.ts` (modified) — the in-memory repository supports the new field and method.
- `apps/api/test/accounts/account-use-cases.test.ts` (modified) — new and adjusted tests.

**Logic**
`CreateAccount` stores `data.includeInAvailable ?? defaultIncludeInAvailable(data.type)` and, as a second line of defence behind the shared contract, forces false for a credit card. `ListAccounts` loads the active accounts once, computes each balance, and groups the balances with `sumExact` into `availableTotals` (included), `netWorthTotals` (all) and `debtTotals` (type credit card), each with a zero for a currency with no accounts, and counts the active cards into `creditCardCount`. `SetIncludeInAvailable.execute(scope, id, value)` calls `accounts.setIncludeInAvailable`, which returns one of `updated`, `not_found`, `archived` or `credit_card`: `not_found` becomes the 404 through `notFoundUnlessAllowed`, `archived` raises `AccountArchived` (code `ACCOUNT_ARCHIVED`), `credit_card` raises `CreditCardSettingLocked`, `updated` returns the account with its balance. The card rule is checked before the archived rule.

**Error handling**
- A missing or foreign account raises the not-found error (404), identical to a missing id.
- An archived account raises `AccountArchived` (409).
- A credit card account raises `CreditCardSettingLocked` (400 at the route).
- A failing movements port propagates, so no total is ever guessed (existing behaviour kept).

**Required tests**
- [ ] create without a setting stores true for cash, bank account and digital wallet and false for savings (validates AC-03, AC-04).
- [ ] create stores an explicit value for a non-card type instead of the default (validates AC-05).
- [ ] create stores false for a credit card with and without a setting (validates AC-09).
- [ ] set on an active non-card account persists the value and leaves name, type, currency and balance unchanged (validates AC-07).
- [ ] set on a credit card raises `CreditCardSettingLocked` (400 error path) and leaves the account unchanged (validates AC-11).
- [ ] set on an archived account raises `AccountArchived` (409 conflict), and succeeds after the account is unarchived (validates AC-12, AC-13).
- [ ] set on another user's account raises not found (404 error path), identical to a missing id (validates AC-22).
- [ ] list `availableTotals` equals the sum of the included active balances and does not subtract card balances (validates AC-14).
- [ ] list `availableTotals` is 0 for a currency with no included account (validates AC-15).
- [ ] list `netWorthTotals` equals the sum of all active balances, cards included (validates AC-16).
- [ ] list `debtTotals` equals the sum of the active card balances per currency (validates AC-19).
- [ ] list totals stay exact above the signed 64-bit maximum (validates AC-17).
- [ ] list `debtTotals` is 0, `creditCardCount` is 0 and the account list has no card when the user has none (validates AC-20).
- [ ] list `creditCardCount` counts active cards across all pages and ignores archived cards (validates AC-19).
- [ ] a failing movements port makes the list fail with the port error and returns no totals (error path).

**Completion criterion**
`account-use-cases.test.ts` passes with the fake repository and `pnpm lint` passes (domain and application import nothing from infrastructure).

## Block 4 — Drizzle repository

**Files**
- `apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts` (modified) — column mapping, create, `listActive` and `setIncludeInAvailable`.
- `apps/api/test/accounts/account-repository.test.ts` (modified) — repository tests against PostgreSQL; its raw `insert into accounts` statements (two) gain the new column.

**Logic**
`columns` gains `includeInAvailable`; `create` inserts it; `listActive` also selects `type` and `includeInAvailable`. `setIncludeInAvailable(scope, id, value)` runs in one transaction: it reads the row with `scopedRow(scope, id)` (the existing helper) `FOR UPDATE` and answers `not_found` (no row), `credit_card` (type card, checked first) or `archived`; for an active non-card row it updates `include_in_available` and sets `updated_at = now()` only when the value changes (an equal value writes nothing and returns the row, like `setArchived`), then answers `updated`. The update only changes the setting and `updated_at`, so name, type, currency and opening balance cannot change. `listActive` also feeds the active card count.

**Data model**
- No new field: uses `accounts.include_in_available boolean NOT NULL` from Block 2 (no default, the credit card CHECK, no new index; reads stay on `accounts_owner_created_idx`).

**Error handling**
- No row in scope returns `not_found` and never reveals whether the id exists for another owner.
- A credit card is classified `credit_card` by the locked read and is never updated, whether archived or not.
- The read-then-update runs under a row lock in one transaction, so an account archived concurrently is either seen as archived or updated before the archive, never updated while archived.

**Required tests**
- [ ] create persists `includeInAvailable` and reading returns it (validates AC-01).
- [ ] `setIncludeInAvailable` on an active non-card account changes only the setting and `updated_at` (validates AC-07).
- [ ] `setIncludeInAvailable` on a credit card returns `credit_card` (400 error path) and the row is unchanged, including an archived card (validates AC-11).
- [ ] `setIncludeInAvailable` on an archived account returns `archived` (409 conflict) and the row is unchanged (validates AC-12).
- [ ] `setIncludeInAvailable` on another owner's account returns `not_found` (404 error path) and the row is unchanged (validates AC-22, NFR-04).
- [ ] `listActive` returns type and setting for active accounts only and is scoped to the owner (validates NFR-04).
- [ ] a refused update (card, archived or foreign) leaves `updated_at` untouched (error path).
- [ ] setting the value an account already has writes nothing and leaves `updated_at` untouched (validates AC-07).

**Completion criterion**
`account-repository.test.ts` passes against the test database and `pnpm typecheck` passes for `apps/api`.

## Block 5 — HTTP routes and presenter

**Files**
- `apps/api/src/accounts/infrastructure/http/account-routes.ts` (modified) — the new route, the card error translation.
- `apps/api/src/accounts/infrastructure/http/account-presenter.ts` (modified) — the new field and the three totals.
- `apps/api/src/shared/http/error-handler.ts` (modified) — `ACCOUNT_ARCHIVED: 409` in the status map; `mapError` emits `fields` for any `AppError` that carries them.
- `apps/api/test/accounts/account-routes.test.ts` (modified) — HTTP integration tests; `totals` assertions become `netWorthTotals`.

**Logic**
`createAccount` passes `body.includeInAvailable`. `PUT /accounts/:id/include-in-available` builds a write scope, calls `SetIncludeInAvailable`, writes an audit line with the user id, the account id and the new boolean only (never the name or an amount), and answers the account. A `CreditCardSettingLocked` reaches the central error handler, which answers 400 `VALIDATION_FAILED` with the `fields` the error carries (`body.includeInAvailable`); the route has no try/catch. The presenter maps `includeInAvailable`, formats the three totals maps through `formatMinorUnitsString` and passes `creditCardCount`.

**API contract**
- `POST /accounts` — Request body adds optional `includeInAvailable` (boolean). Response 201: `AccountResponse` with `includeInAvailable`. Errors: 400 `VALIDATION_FAILED` (with `fields`, including `body.includeInAvailable`), 401, 403 `EMAIL_NOT_VERIFIED`, 409 `ACCOUNT_NAME_TAKEN`. Auth: session cookie plus verified email.
- `GET /accounts` — Query unchanged. Response 200: `{ items: AccountResponse[], availableTotals: { ARS, USD }, netWorthTotals: { ARS, USD }, debtTotals: { ARS, USD }, creditCardCount, total, limit, offset }`. Errors: 400, 401, 403. Auth: session plus verified email.
- `GET /accounts/:id` — Response 200: `AccountResponse` with `includeInAvailable`. Errors: 400, 401, 403, 404. Auth: session plus verified email.
- `PUT /accounts/:id/include-in-available` — Params: `id` UUID. Request body: `{ includeInAvailable: boolean }`. Response 200: `AccountResponse`, idempotent. Errors: 400 `VALIDATION_FAILED` (non-boolean value, or a credit card, with `fields` `["body.includeInAvailable"]`), 401, 403 `EMAIL_NOT_VERIFIED`, 404 `NOT_FOUND`, 409 `ACCOUNT_ARCHIVED`. Auth: session plus verified email, plus the existing origin guard for state-changing methods.
- `PATCH /accounts/:id` — Request body unchanged; `includeInAvailable` present means 400.

**Input validation**
- The new route validates params and body with the shared schemas of Block 1 through `validate`; handlers never read `req.body`.
- The boolean must be a JSON boolean; strings, numbers and null are rejected; unknown keys are stripped.

**Error handling**
- A non-boolean value answers 400 `VALIDATION_FAILED` naming `body.includeInAvailable`, without echoing the value.
- A credit card answers 400 `VALIDATION_FAILED` naming `body.includeInAvailable`.
- An archived account answers 409 `ACCOUNT_ARCHIVED`.
- Another user's account answers 404 `NOT_FOUND`, identical to a missing id.
- A missing session answers 401 and an unverified email answers 403 `EMAIL_NOT_VERIFIED`; a response that does not match its schema becomes 500 `INTERNAL`.

**Required tests**
- [ ] `POST /accounts` returns `includeInAvailable` and the list returns it for each account (validates AC-01, AC-02).
- [ ] create with a non-boolean `includeInAvailable` answers 400 naming `body.includeInAvailable` and creates nothing (validates AC-06).
- [ ] create defaults by type: cash, bank account and digital wallet true, savings false, credit card false (validates AC-03, AC-04, AC-09).
- [ ] create keeps an explicit value for a non-card type (validates AC-05).
- [ ] create of a credit card with `includeInAvailable: true` answers 400 naming the field and creates nothing (validates AC-10).
- [ ] `PUT` on an active non-card account persists the value, leaves the other fields unchanged and is idempotent (validates AC-07).
- [ ] `PUT` with a non-boolean body answers 400 naming `body.includeInAvailable` and leaves the account unchanged (validates AC-08).
- [ ] `PUT` on a credit card answers 400 naming the field and leaves the account unchanged (validates AC-11).
- [ ] `PUT` on an archived account answers 409 `ACCOUNT_ARCHIVED`, and works after unarchive (validates AC-12, AC-13).
- [ ] `PUT` on another user's account answers 404 with the same body as a missing id (validates AC-22).
- [ ] the list returns `availableTotals`, `netWorthTotals` and `debtTotals` per currency over more than one page (validates AC-14, AC-15, AC-16, AC-19).
- [ ] the list shows no card balance in `availableTotals` and an empty `debtTotals` without cards (validates AC-14, AC-20).
- [ ] the audit line of `PUT` holds the user id, the account id and the boolean and neither the name nor an amount (validates NFR-04).
- [ ] `PUT` answers 401 without a session, 403 `EMAIL_NOT_VERIFIED` for an unverified user and 403 without the origin header (error path).
- [ ] `PATCH` with `includeInAvailable` answers 400 and the account is unchanged (error path for FR-04).

**Completion criterion**
`account-routes.test.ts` passes through the identity harness, `GET /accounts` answers 200 with the three maps, and `pnpm typecheck` and `pnpm lint` pass for `apps/api`.

## Block 6 — Web API client, error key and catalogs

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `setIncludeInAvailable`, the `ACCOUNT_ARCHIVED` message key, the list response type.
- `apps/web/messages/en.json` (modified) — new labels and the `accountArchived` error.
- `apps/web/messages/es.json` (modified) — the same keys in Spanish.
- `apps/web/test/api-client.test.ts` (modified) — client tests.
- `apps/web/test/i18n-catalogs.test.ts` (modified) — asserts the four labels in both locales.

**Logic**
`setIncludeInAvailable(id, includeInAvailable)` sends a `PUT` request to the include-in-available route of the account through the existing `onAccount` helper (which refuses ids that are not a plain path segment) and parses the account response. `MESSAGE_KEY_BY_CODE` maps `ACCOUNT_ARCHIVED` to `accountArchived`. Catalog keys: `accounts.headline.available` ("Disponible" / "Available"), `accounts.headline.netWorth` ("Patrimonio neto" / "Net worth"), `accounts.debt.title` ("Deudas" / "Debt"), `accounts.fields.includeInAvailable` ("Incluir en disponible" / "Include in available"), `errors.accountArchived` (an archived account cannot change this setting). The keys `accounts.list.totals` and `accounts.totals.*` are removed because the headline replaces them.

**Input validation**
- The client builds the request body from a boolean parameter only; the id goes through the existing path-segment guard before any request is made.

**Error handling**
- An id that is not a plain path segment returns a not-found failure without a request (existing guard reused).
- A 409 `ACCOUNT_ARCHIVED` surfaces as the `accountArchived` message key.
- A 400, 401, 404 or a network failure surface through the existing message keys.

**Required tests**
- [ ] `setIncludeInAvailable` sends `PUT` with the JSON boolean body and parses the account (validates AC-07).
- [ ] `setIncludeInAvailable` maps a 409 `ACCOUNT_ARCHIVED` to the `accountArchived` key (validates AC-12).
- [ ] `setIncludeInAvailable` returns a failure for an invalid id without sending a request (error path).
- [ ] `setIncludeInAvailable` maps a 400 and a network failure to their message keys (error path).
- [ ] the list client parses the three totals maps (validates AC-14, AC-16, AC-19).
- [ ] the catalogs hold the four labels with the exact Spanish and English wording and the parity test passes (validates AC-23, NFR-05).

**Completion criterion**
`api-client.test.ts` and `i18n-catalogs.test.ts` pass and `pnpm typecheck` passes for `apps/web` once Block 7 updates its remaining callers.

## Block 7 — Web screens: headline, Debt section, setting control

**Files**
- `apps/web/src/components/ui/checkbox.tsx` (new) — owned native checkbox with theme tokens, no dependency, shared by the row and the create form.
- `apps/web/src/features/accounts/components/accounts-headline.tsx` (new) — presentational headline: Available large, Net worth small, per currency.
- `apps/web/src/features/accounts/components/account-row.tsx` (new) — one account row extracted from the list, with the setting checkbox.
- `apps/web/src/features/accounts/components/account-list.tsx` (modified) — headline, the non-card list, the Debt section with its total.
- `apps/web/src/features/accounts/containers/accounts-container.tsx` (modified) — three totals, the setting action.
- `apps/web/src/features/accounts/components/account-form.tsx` (modified) — checkbox with the type default, hidden for credit card.
- `apps/web/src/features/accounts/containers/create-account-container.tsx` (modified) — sends the setting.
- `apps/web/test/accounts-components.test.tsx` (modified) — component tests.
- `apps/web/test/accounts-containers.test.tsx` (modified) — container tests.

**Logic**
Presentational components stay pure. `AccountsHeadline` renders, per currency, Available in a larger type size class and Net worth in a smaller one, both through `formatMoney` and the locale. `AccountList` (active view only) renders the headline, the section of non-card accounts, and, when `creditCardCount` is above 0, a `Debt` section with the cards of the page and a per-currency Debt total from `debtTotals` (visibility never depends on which cards the page holds); the archived view stays a flat list without headline or Debt section. `AccountRow` shows the setting checkbox from `ui/checkbox.tsx` (labelled "Incluir en disponible" / "Include in available", `aria-label` with the account name) only for active non-card accounts; toggling calls `onToggleAvailable(id, value)`. The container calls `api.setIncludeInAvailable`, updates the row and reloads silently so totals stay the API's; `ACCOUNT_ARCHIVED` and other failures show the existing action alert. The create form shows the checkbox for cash, bank account, digital wallet and savings, initialises it from `defaultIncludeInAvailable(type)` when the type changes (until the user touches it), hides it for credit card and omits the value for a card.

**Input validation**
- The checkbox yields a boolean; the form never sends a string for it, and a credit card submission carries no `includeInAvailable`.
- The type default comes from the shared `defaultIncludeInAvailable`, never from a duplicated list in the web.

**Error handling**
- A failed setting change (409 archived, 404, network) keeps the previous value on screen and shows the action alert with the mapped message.
- A 401 redirects to sign-in like every other action.
- A create failure keeps the existing field errors; a 400 naming `body.includeInAvailable` shows the generic validation alert.

**Required tests**
- [ ] the headline renders Available larger than Net worth for each currency, with the formatted amounts (validates AC-14, AC-16, AC-18).
- [ ] the headline shows 0 Available for a currency with no included account (validates AC-15).
- [ ] cards render only in the Debt section with the per-currency Debt total, and not in the other section (validates AC-19).
- [ ] the Debt section is absent when `creditCardCount` is 0, and present when it is above 0 even if the page lists no card (validates AC-19, AC-20).
- [ ] the shared checkbox renders checked and unchecked states, forwards the change and fails open to a disabled state while a request is pending (error path for double submit).
- [ ] the labels render in Spanish and in English from the catalogs, with no hardcoded string (validates AC-23, NFR-05).
- [ ] toggling the checkbox calls the API, updates the row and reloads the totals (validates AC-07).
- [ ] the checkbox is absent for credit cards and for archived accounts (validates AC-11, AC-12).
- [ ] a 409 `ACCOUNT_ARCHIVED` failure on toggle keeps the previous value and shows the alert (error path for AC-12).
- [ ] the create form defaults the checkbox by type, hides it for credit card and sends no value for a card (validates AC-03, AC-04, AC-09).
- [ ] the create form sends an explicit value for a non-card type (validates AC-05).
- [ ] a network failure on toggle shows the alert and keeps the previous value (error path).
- [ ] a 401 on toggle redirects to sign-in (error path).

**Completion criterion**
The web component and container tests pass, `pnpm typecheck` and `pnpm lint` pass for the whole repository (all `totals` callers are gone), and the screens use theme tokens only.

## Block 8 — Performance, overflow and end-to-end coverage

**Files**
- `apps/api/test/perf/accounts-list.perf.test.ts` (modified) — the list response with three totals under the 300 ms p95 budget; its `generate_series` seeding statement gains the new field.
- `apps/api/test/accounts/account-routes.test.ts` (modified) — the 9,300 accounts at 10^15 overflow case with the three totals; its raw insert gains the new field.
- `apps/web/e2e/accounts.spec.ts` (modified) — end-to-end flow: headline, Debt section, toggle.
- `apps/web/test/routes.test.tsx` (modified) — adjusts the accounts route fixtures to the new response.

**Logic**
Covers FR-07, FR-08, FR-10, NFR-01 and NFR-02 end to end. The perf test keeps its 100-account, 100,000-movement setup and asserts p95 below 300 ms with all three totals computed. The overflow test lists 9,300 accounts at 10^15 minor units, mixing included, non-included and card accounts, and checks the exact `availableTotals`, `netWorthTotals` and `debtTotals`. The end-to-end spec registers a user, creates a cash, a savings and a credit card account, checks the Available and Net worth numbers and the Debt section, toggles savings to included and checks the headline, and verifies that the archived view has no setting control.

**Error handling**
- A perf run above 300 ms p95 fails the suite.
- An arithmetic failure in the 9,300-account listing fails the test (it must answer 200 with exact totals).
- An end-to-end flow that cannot find the Debt section or a label in Spanish fails the spec.

**Required tests**
- [ ] the accounts list p95 stays below 300 ms with three totals at 100 accounts and 100,000 movements; above it the run must fail (error path, validates NFR-02).
- [ ] 9,300 accounts at the opening balance bound list with exact available, net worth and debt totals and no 500 error (validates AC-17, NFR-01).
- [ ] end-to-end: the headline shows Available and Net worth, credit cards appear only under Debt, and toggling savings changes Available but not Net worth (validates AC-14, AC-16, AC-19, AC-07).
- [ ] end-to-end: the archived view shows no setting checkbox, and an unarchived account can change it again (validates AC-12, AC-13).
- [ ] end-to-end in English: the four labels appear with the exact wording, and a missing label is an error (error path, validates AC-23).

**Completion criterion**
`pnpm test`, `pnpm test:perf` and `pnpm e2e` pass for the accounts specs, `pnpm lint` and `pnpm typecheck` pass, and `pnpm test:coverage` stays at or above 80% lines, branches and functions.

## Final verification
- Every FR and AC of the PRD is covered by a block and named by a test; the migration is 0011 with a `when` above every existing one.
- Net worth keeps its meaning (all active accounts); Available excludes credit cards and savings by default; card debt reduces Net worth only.
- No `totals` field or caller remains; no new runtime dependency; no hardcoded user-visible string; money stays `bigint` and decimal strings.
- Shared files touched with open branches (api-client, catalogs, `migration.test.ts`, `_journal.json`, `account.ts` in shared) are listed in the PLAN report for merge-order handling.
