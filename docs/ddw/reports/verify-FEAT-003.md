# Verification FEAT-003

| Field | Value |
|---|---|
| Module | `apps/api/src/accounts/**`, `packages/shared/src/accounts/account.ts`, `apps/web/src/features/accounts/**`, `apps/web/src/components/ui/checkbox.tsx`, migration `0011_account_include_in_available` |
| Line coverage | 96.92% |
| Branch coverage | 92.51% |
| Function coverage | 94.44% |
| Coverage floor | 80% (AGENTS.md, "Testing"), measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

The independent cross-verification (a `ddw-module-verifier` that did not write the code) read every
AC, block and NFR against the code and the tests. The coverage numbers come from the full run in
`docs/ddw/reports/tests-FEAT-003.md` (1616 of 1616 tests passed; `coverage/coverage-summary.json`
written after the last code commit). DDW does not run the suite; these are the numbers of the run
recorded there.

Coverage of the new or modified files (lines / branches / functions): the use cases, domain,
presenter, shared contracts, `checkbox.tsx`, `account-row.tsx`, `accounts-headline.tsx`,
`account-form.tsx` and `format-amount.ts` are at 100 / 100 / 100; `drizzle-account-repository.ts`
100 / 86.66 / 100; `account-routes.ts` 100 / 80 / 100; `error-handler.ts` 90.47 / 95 / 100 (the
uncovered lines are the existing `headersSent` branch); `account-list.tsx` 100 / 93.75 / 100;
`accounts-container.tsx` 95.57 / 73.91 / 100 (its uncovered branches are existing error branches
of rename, archive and delete); `create-account-container.tsx` 95.55 / 92.1 / 100; `api-client.ts`
100 / 98.07 / 97.56. Every changed file is at or above 80% for lines and functions, and the
combined figure for the changed files is above 80% for branches.

## Acceptance criteria
- ✅ AC-01 — `account-repository.test.ts` "create persists includeInAvailable and reading returns it"; `account-routes.test.ts` "POST returns includeInAvailable and the list returns it" (`drizzle-account-repository.ts:create`)
- ✅ AC-02 — `account-contracts.test.ts` "requires includeInAvailable on the account response"; route test on list and read (`account-presenter.ts:presentAccount`)
- ✅ AC-03 — `account-contracts.test.ts` "is true for cash, bank_account, digital_wallet"; `account-use-cases.test.ts` "stores the type default"; route test "defaults per type" (`create-account.ts`)
- ✅ AC-04 — the same three tests for savings (`defaultIncludeInAvailable`)
- ✅ AC-05 — `account-use-cases.test.ts` "stores an explicit value instead of the default"; route test "keeps an explicit value"
- ✅ AC-06 — `account-contracts.test.ts` non-boolean cases; route test "rejects the non-boolean naming body.includeInAvailable and creates nothing"
- ✅ AC-07 — `account-use-cases.test.ts` "persists the value and leaves name, type, currency and balance unchanged"; repository tests "changes only the setting and updated_at" and "equal value writes nothing"; route test "persists the value and is idempotent"; e2e toggle (`set-include-in-available.ts`, `setIncludeInAvailable` in the repository)
- ✅ AC-08 — `account-contracts.test.ts` setting schema rejections; route test for `{}`, `'true'`, `1`, `null`
- ✅ AC-09 — `account-use-cases.test.ts` "stores false for a credit card with and without a setting"; route test for credit card defaults
- ✅ AC-10 — `account-contracts.test.ts` "fails a credit card with includeInAvailable true"; route test "refuses a credit card created as included"; migration test "refuses a credit card marked as included on insert and on update"
- ✅ AC-11 — `account-use-cases.test.ts` credit card raises `CreditCardSettingLocked`; repository test for card and archived card; route test with the exact body `{code, fields:['body.includeInAvailable']}`
- ✅ AC-12 — `account-use-cases.test.ts` raises `AccountArchived`; repository archived test and row-lock race test; route test 409 `ACCOUNT_ARCHIVED`; the handler status-map test
- ✅ AC-13 — use case and route tests set the value after unarchive; e2e archived-view test
- ✅ AC-14 — `account-use-cases.test.ts` "availableTotals sums the included active balances and does not subtract cards"; route test over more than one page; headline tests; e2e (`totalsOf` in `domain/account.ts`)
- ✅ AC-15 — `account-use-cases.test.ts` "availableTotals is 0 for a currency with no included account"; headline test "shows 0 Available"
- ✅ AC-16 — `account-use-cases.test.ts` net worth includes cards; route and headline tests; e2e (Net worth unchanged by the toggle)
- ✅ AC-17 — `account-use-cases.test.ts` "exact above the signed 64-bit maximum"; three 9,300-account route tests (mixed, all cash, all cards); headline "formats balances beyond int64"
- ✅ AC-18 — `accounts-components.test.tsx` "renders Available larger than Net worth" (class based: `text-3xl` against `text-sm`, `accounts-headline.tsx`)
- ✅ AC-19 — `account-use-cases.test.ts` `debtTotals` and `creditCardCount`; route multi-page test; "lists cards only under Debt"; e2e (`account-list.tsx` Debt section)
- ✅ AC-20 — use case and route tests with no cards; component tests "absent when creditCardCount is 0" and "follows creditCardCount exactly"
- ✅ AC-21 — `migration.test.ts` "backfills accounts of every type created before it" and "SQL backfill gives the same result as defaultIncludeInAvailable for each type" (`0011_account_include_in_available.sql`)
- ✅ AC-22 — `account-use-cases.test.ts` not found for a foreign id; repository test with a positive control; route test with the same body as a missing id (`scopedRow` in the repository)
- ✅ AC-23 — `i18n-catalogs.test.ts` four labels in both locales; `accounts-components.test.tsx` English labels; e2e in English and Spanish

## Spec blocks
- ✅ Block 1 — shared contracts, default function, `ACCOUNT_ARCHIVED`, `AppError` fields; 10 required tests present (commit 0e7f160)
- ✅ Block 2 — migration 0011 with backfill, CHECK, rollback script, journal `when` 1790943616052 (written by drizzle-kit, above main's maximum 1790895423195) and snapshot; 9 required tests present (commit b227434)
- ✅ Block 3 — domain, ports, use cases and totals; 15 required tests plus three extras present (commit 3027225)
- ✅ Block 4 — Drizzle repository with the row-locked classification; 8 required tests plus the race test present (commit c74491d)
- ✅ Block 5 — route, presenter and central `fields` mapping; 15 required tests present (commit f4aafa7)
- ✅ Block 6 — web client method, error key and catalogs; 6 required tests present (commit 08b4986)
- ✅ Block 7 — headline, Debt section, checkbox component, account form; 13 required tests present (commit 8bfa2bc)
- ✅ Block 8 — perf budget, the three overflow tests and three e2e tests present (commit 1da5979)

## Tests
- ✅ F-VER-06: every test the spec lists exists and passes (1616 of 1616 in the full run, perf 6 of 6, e2e 62 of 62).
- ✅ Sad-path tests: every input path has one — non-boolean on create and on the setting route, a credit card created as included, a credit card changed (400 naming `body.includeInAvailable`), an archived account (409 `ACCOUNT_ARCHIVED`), a foreign or missing account (404 with the same body), a non-UUID id, 401, 403 `EMAIL_NOT_VERIFIED` and 403 without the origin headers, NOT NULL and CHECK violations in the database, `includeInAvailable` in the rename body, the web client's invalid id, 400, network and 409 paths, and UI toggle failures (409, network, 401) that keep the previous value.
- ✅ NFR-01 to NFR-05: exact bigint totals with three 9,300-account tests; one list query with p95 30.3 ms against 300 ms; additive migration with rollback and forced-failure tests; owner-scoped locked read and update; es and en catalogs in parity with no hardcoded strings.

## Warnings
- ⚠️ TDD evidence of Block 8: those tests verify behaviour built in Blocks 3 to 7 (perf budget, 9,300-account overflow, e2e flow), so they passed on first run. Their non-vacuity was shown by mutation: counting cards into Available made the overflow and perf tests fail (`ARS expected "4000000000000000000", received "6300000000000000000"`), a 0.1 ms bound failed (`expected 30.2864 to be less than 0.1`), and mutating the totals made all three 9,300-account tests fail. The independent verifier flagged this as the only blocking item under a strict reading. Human decision (2026-10-02): the mutation evidence stands in for failing-first evidence for Block 8, because those tests exercise behaviour built in Blocks 3 to 7; the verdict is therefore PASSED.
- ⚠️ `drizzle-account-repository.ts:52` falls back to `defaultIncludeInAvailable(type)` when the value is missing, duplicating the use case rule; the NOT NULL column still enforces the value.
- ⚠️ `account-contracts.test.ts:429` tags a response-schema test "(AC-22)"; AC-22 is ownership. Cosmetic.
- ⚠️ `SetIncludeInAvailable` commits the write before reading balances through the movements port, so a port failure answers 500 although the setting persisted (the same pattern as archive).
- ⚠️ A 400 ms timer in the row-lock race test (`account-repository.test.ts`) only asserts "still blocked", so it cannot fail in the wrong direction.
- ⚠️ The `drizzle/rollback/0006_accounts.down.sql` header got a comment-only edit that is not in the Block 2 file list.
- ⚠️ Cards beyond the first 100 accounts are not listed in the Debt section; `creditCardCount` and `debtTotals` stay exact (accepted limitation in the spec).

Result: PASSED
