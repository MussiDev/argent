# Verification DISC-001-02a

Two runs are recorded here. Run 1 passed on commit `fa8dfaf`; after it the human decided L-1 and I-2, the ticket went through a corrective loop (VERIFY to CODE to PLAN to DEFINE and back) and Run 2, at the end of this file, is the verdict on commit `3bb752a`. Where the two differ, Run 2 supersedes Run 1 (the coverage numbers in the table below are Run 2's).

## Run 1 (commit fa8dfaf)

| Field | Value |
|---|---|
| Module | `apps/api/src/accounts/**`, `packages/shared/src/money.ts` and `accounts/**`, `apps/web/src/features/accounts/**` |
| Line coverage | 96.77% (new and modified code, run 2; whole project 96.62%) |
| Branch coverage | 88.14% (new and modified code, run 2; whole project 92.4%) |
| Function coverage | 96.92% (new and modified code, run 2; whole project 93.78%) |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint apps packages` — clean, 0 findings; `pnpm typecheck` — clean; `pnpm exec prettier --check --end-of-line auto .` — clean |

Cross-verification by `ddw-module-verifier` (sonnet, an agent that did not write the code), on the
tree of commit `fa8dfaf`. It re-ran 284 tests of the new code and 584 tests of the surrounding
suites (error handler, boundaries, migrations, build output, i18n, API client, identity), all green.
It did not re-run e2e or perf, which this report takes from `docs/ddw/reports/tests-DISC-001-02a.md`
(50/50 e2e, 5/5 perf with an accounts p95 of about 35 ms against 300 ms).

DDW does not run the suite: the numbers above are the account of those runs.

## Acceptance criteria
- ✅ AC-01 — `account-routes.test.ts` "creates an account and lists it with its opening balance (AC-01)"; `account-use-cases.test.ts` "returns the account with balance equal to the opening balance (AC-01)"; `accounts-containers.test.tsx` "creates the account once and goes back to the list (AC-01)" (`account-routes.ts:82`, `create-account.ts:13`)
- ✅ AC-02 — `account-routes.test.ts` "rejects a missing %s naming the field (AC-02)" (name, type, currency); `accounts-containers.test.tsx` "names each missing field, focuses the first one and sends nothing (AC-02)"
- ✅ AC-03 — `accounts-components.test.tsx` "offers exactly the five account types and the two currencies (AC-03)"; `account-contracts.test.ts` "offers exactly the five types"
- ✅ AC-04 — `account-routes.test.ts` "rejects currency EUR (AC-04)"; `account-repository.test.ts` check constraints
- ✅ AC-05 — `account-routes.test.ts` "rejects %o and leaves the account unchanged (AC-05)"; `account-repository.test.ts` raw UPDATE fails with 23514 and leaves the row unchanged
- ✅ AC-06 — `account-routes.test.ts` "renames, visible in GET and in the list (AC-06)"; `account-use-cases.test.ts` "persists and is returned by get and list (AC-06)"; `accounts-containers.test.tsx` "renames inline and shows the new name (AC-06)"
- ✅ AC-07 — `account-routes.test.ts` "archive hides from the default list, keeps GET, lists under archived=true (AC-07)"; `account-use-cases.test.ts` "hides the account ... deletes nothing (AC-07, AC-08)"; `accounts-containers.test.tsx` archive test (the history half is deferred to PRD 03, see Deferrals)
- ✅ AC-08 — `account-routes.test.ts` "unarchive restores the account, idempotently (AC-08)"; `account-repository.test.ts` archive and unarchive toggle `archived_at`
- ✅ AC-09 — `account-routes.test.ts` "answers 204 for an account without movements (AC-09)"; `account-repository.test.ts` deletes an unreferenced account
- ✅ AC-10 — `account-routes.test.ts` "answers 409 ACCOUNT_HAS_MOVEMENTS when movements exist and keeps the account (AC-10)"; `account-use-cases.test.ts` "fails with AccountHasMovements when the port reports movements, and the row stays (AC-10)"; `account-repository.test.ts` ON DELETE RESTRICT backstop; `accounts-containers.test.tsx` "answers a refused deletion with the message and an archive-instead action (AC-10)" (the end-to-end test with a real movement is deferred to PRD 03)
- ✅ AC-11 — `account-routes.test.ts` "adds the movements sum to the opening balance (AC-11)" and "balance equals the opening balance with the default adapter (AC-11)"; `account-use-cases.test.ts` balance with a negative sum
- ✅ AC-12 — `account-routes.test.ts` "totals per currency cover every active account across pages (AC-12)" (exact totals `ARS 15005`, `USD 77`, archived excluded); `account-use-cases.test.ts`; `accounts-components.test.tsx` totals display
- ✅ AC-13 — `account-routes.test.ts` duplicate name on create and PATCH (409); `account-repository.test.ts` `Caja`/`caja` and `Ñandú`/`ñandú`; `accounts-containers.test.tsx` "shows the duplicate-name message on the name field (AC-13)"
- ✅ AC-14 — `account-routes.test.ts` "answers another user account exactly like a missing id, and changes nothing (AC-14)" (five operations) and "answers 404, never 409, for another user's account that has movements"; `account-repository.test.ts` other owner's id gives null or false
- ✅ AC-15 — `account-routes.test.ts` "lists only the caller accounts (AC-15)"; `account-use-cases.test.ts`; `accounts.spec.ts` second user never sees the first user's accounts
- ✅ AC-16 — `account-routes.test.ts` "defaults an omitted opening balance to "0" (AC-16)"; `accounts-containers.test.tsx` "sends an empty opening balance as omitted (AC-16)"
- ✅ AC-17 — `account-routes.test.ts` "accepts a negative opening balance and lists it (AC-17)"; `accounts-containers.test.tsx` "sends -1.500,00 typed in es as a negative amount in minor units (AC-17)"; `account-repository.test.ts` stores the int64 minimum

Every API test asserts the response body and the persisted state, not only the status code.

## Non-functional requirements
- ✅ NFR-01 — `money.test.ts` "sums 100,000 generated bigint amounts to the exact total" (closed-form expected value) and the repository test for balances beyond 2^53
- ✅ NFR-02 — `accounts-list.perf.test.ts` (100 accounts, 100,000 test-only movement rows, p95 about 35 ms against 300 ms) and the chunking test
- ✅ NFR-03 — `account-routes.test.ts` "accepts limit 100 and rejects 101 (NFR-03)"
- ✅ NFR-04 — every repository method applies `scopedTo`; cross-owner tests in `account-repository.test.ts` and `account-routes.test.ts`
- ✅ NFR-05 — `account-contracts.test.ts` name schema (50 accepted, 51 rejected, emoji counted once) and the repository check constraints

## Spec blocks
- ✅ Block 1 — every task done (5 of 5 files), 13 of 13 required tests named above
- ✅ Block 2 — every task done (6 of 6), 4 of 4 required tests
- ✅ Block 3 — every task done (8 of 8), 14 of 14 required tests; the repository FK mapping is proven at repository level
- ✅ Block 4 — every task done (9 of 9), 13 of 13 required tests; migration 0006 applies, rolls back and re-applies
- ✅ Block 5 — every task done (4 of 4), 18 of 18 required tests
- ✅ Block 6 — every task done (2 of 2), 8 of 8 required tests
- ✅ Block 7 — every task done (11 of 11), 14 of 14 required tests
- ✅ Block 8 — every task done (3 of 3), 8 of 8 required tests (e2e 50/50 and perf 5/5 per the test report). Test-only table `perf_movements` (account_id uuid not null, amount bigint not null, index on account_id) is created by the benchmark, dropped in its teardown and never part of a migration

## Tests
- ✅ Sad-path tests: all seven routes have 401 and 403 `EMAIL_NOT_VERIFIED` cases; POST rejects missing name/type/currency, `EUR`, `12.5`, `1e3`, duplicates and missing origin headers; list rejects `archived=maybe`, `offset=-1`, blank `limit`, `limit=101`; `:id` routes reject a non-UUID and answer 404 for foreign ids; PATCH rejects empty and 51-code-point names and `type`/`currency`; DELETE answers 409; the forms reject missing fields, a malformed amount, 409, network failure and 401; the money helpers throw or return null on overflow and malformed input; the repository rejects bad names, types and currencies, duplicates, foreign keys and foreign owners
- ✅ Coverage per file: no file of the new code is below 80% lines or functions; branches are below 80% only in `account-routes.ts` (66.7%, the unreachable fail-closed `auth` guard), `delete-account.ts` (75%, the race between find and delete) and `accounts-container.tsx` (71%), and the three-metric aggregate for the new code is above the floor
- ✅ TDD evidence (supplied from the implementers' reports, no separate file this time): Block 1 red 49 of 49 at the missing exports (`TypeError: parseAmountInput is not a function`); Block 2 red 4 of 5 (`expected 500 to be 409` and the web client returning `unexpected`); Block 3 red at import (`Cannot find module '../../src/accounts'`); Block 4 red 17 of 17 at import for the repository tests, the migration tests adapted without a prior red run; Block 5 red 38 of 38 with a stub that mounted no routes (`expected 404 to be 201`); Block 6 red 19 of 19 (`client.createAccount is not a function`) and a vacuous-fixture fix in round 2; Block 7 red at import for three test files and 5 of 5 behavioural follow-up tests red; Block 8 tests over existing code (guards), one e2e race fixed first. Each commit bundles the code with its tests.

## Deferrals to PRD 03 (human-approved in the spec)
- AC-10 end to end with a real movement: substitutes are the use-case test with a fake port and the ON DELETE RESTRICT repository test.
- The history half of AC-07: the tests assert that archiving deletes nothing and the account stays readable by id.
- NFR-01 and NFR-02 against the real movements table: substitutes are exact bigint summation and the test-only 100,000-row benchmark.

## Warnings (non-blocking)
- ⚠️ W-VER-02: `delete-account.ts` is at 75% branches (the find-then-delete race) and `accounts-container.tsx` at 71%; the rest of the domain and application code is at 100% lines and 93% branches.
- ⚠️ The web list requests `limit=100` and has no paging control, so a user with more than 100 accounts sees at most 100 rows while the totals cover all of them. Q7 (no cap) is a human decision and NFR-02 assumes up to 100 accounts; a paging control is a follow-up.
- ⚠️ Spec drift, all behaviour-neutral: `account-balances.ts` is not in the Block 3 file list; `createAccountRoutes` takes a required `logger`; four extra web files (`account-form-errors.ts`, `account-field.tsx`, `accounts-load-state.tsx`, `use-focus-first-invalid.ts`); the accounts feature imports `FormAlert`, `readField` and `form-errors` from `features/auth`; the migration and build tests derive their throwaway database names from the test database name.
- ⚠️ `nameErrorMessage` re-derives the name rule locally, so a future new name rule (for example I-2) would show "name required" until it is updated.
- ⚠️ Info: the use-case FK test is tautological (the real mapping is tested at repository level); the origin guard is tested on `POST /accounts` only; the SAST report's line numbers for `account-routes.ts` are stale by a few lines; the `db:generate` drift check was verified earlier by the Block 4 verifier, not re-run here.

## Open items owned by the human (not blocking, not acted on)
- L-1: two accounts at the int64 maximum overflow the per-currency total; the accounts screen then answers 500 for that user in both views. No AC or NFR is violated because the PRD allows any signed 64-bit opening balance. Recommendation: a bound on the opening balance, through the PRD.
- I-2: names accept control and bidirectional-control characters. Only NFR-05 (length) applies; React escapes the output and the data is self-owned until PRD 05.

## Run 2 (commit 3bb752a, after the corrective loop for L-1 and I-2)

Cross-verification by a second independent `ddw-module-verifier` (sonnet), which re-ran 342 tests of
the new code, `eslint`, `typecheck`, `prettier --check --end-of-line auto` and a literal
invisible-character grep (clean). e2e (53/53) and perf (5/5) are the account in
`docs/ddw/reports/tests-DISC-001-02a.md`, not re-run by the verifier.

### Acceptance criteria (run 2)
- ✅ AC-01 — `account-routes.test.ts` "creates an account and lists it with its opening balance (AC-01)"; the repository precision test now runs at the bound
- ✅ AC-02 — `account-routes.test.ts` "rejects a missing %s naming the field (AC-02)"
- ✅ AC-03 — `accounts-components.test.tsx` "offers exactly the five account types and the two currencies (AC-03)"
- ✅ AC-04 — `account-routes.test.ts` "rejects currency EUR (AC-04)"
- ✅ AC-05 — `account-routes.test.ts` "rejects %o and leaves the account unchanged (AC-05)"; the immutability trigger survived the migration regeneration
- ✅ AC-06 — `account-routes.test.ts` "renames, visible in GET and in the list (AC-06)"
- ✅ AC-07 — `account-routes.test.ts` "archive hides from the default list, keeps GET, lists under archived=true (AC-07)"
- ✅ AC-08 — `account-routes.test.ts` "unarchive restores the account, idempotently (AC-08)"
- ✅ AC-09 — `account-routes.test.ts` "answers 204 for an account without movements (AC-09)"
- ✅ AC-10 — `account-routes.test.ts` "answers 409 ACCOUNT_HAS_MOVEMENTS when movements exist and keeps the account (AC-10)"
- ✅ AC-11 — `account-routes.test.ts` "adds the movements sum to the opening balance (AC-11)"; `account-use-cases.test.ts` balance exact and without a range limit
- ✅ AC-12 — `account-routes.test.ts` "totals per currency cover every active account across pages (AC-12)"
- ✅ AC-13 — `account-routes.test.ts` duplicate name on create and PATCH (409)
- ✅ AC-14 — `account-routes.test.ts` "answers another user account exactly like a missing id, and changes nothing (AC-14)"
- ✅ AC-15 — `account-routes.test.ts` "lists only the caller accounts (AC-15)"
- ✅ AC-16 — `account-routes.test.ts` "defaults an omitted opening balance to "0" (AC-16)"; `accounts-containers.test.tsx` "sends an empty opening balance as omitted (AC-16)"
- ✅ AC-17 — `account-routes.test.ts` "accepts a negative opening balance and lists it (AC-17)"
- ✅ AC-18 — `account-routes.test.ts` "rejects the opening balance %s beyond 10^15 naming body.openingBalance and creates nothing (AC-18)" (400, field, empty list, zero rows); `account-contracts.test.ts` exact message; `account-repository.test.ts` CHECK 23514; `accounts-containers.test.tsx` out-of-range message with the formatted limit; e2e "the form refuses an opening balance beyond the limit and creates nothing (AC-18, AC-19)"
- ✅ AC-19 — `account-routes.test.ts` "accepts exactly the opening balance %s (AC-19)" for plus and minus 10^15; `account-contracts.test.ts`; `account-repository.test.ts`; `accounts-containers.test.tsx` sends the limits
- ✅ AC-20 — `account-routes.test.ts` "rejects a name with %s naming body.name and creates nothing (AC-20)" and the PATCH variant (zero-width space, right-to-left override, NUL); `account-contracts.test.ts` ten cases for create and rename including soft hyphen, byte order mark, newline and tab; `accounts-containers.test.tsx` and e2e
- ✅ AC-21 — `account-routes.test.ts` "rejects a name made of %s (AC-21)" for create and PATCH; `account-contracts.test.ts` "rejects a name of %s as empty (AC-21)"; `accounts-containers.test.tsx` name-required message; e2e
- ✅ AC-22 — `account-routes.test.ts` "answers 200 with the exact ARS total for 9,300 accounts at 10^15 (AC-22, NFR-06)"; `account-use-cases.test.ts` exact totals above the int64 maximum; `account-contracts.test.ts` response schemas; `accounts-components.test.tsx` "formats balances and totals beyond int64 without throwing (AC-22, NFR-06)"

NFR-06 — the proof in the spec (Q8) was checked against the code: no derived sum passes through the
int64 helpers or int64 response schemas; the exact response schemas are capped at 40 digits.

### Spec blocks (run 2)
- ✅ Block 1 — every task done, tests as in run 1 (its int64 opening-balance extreme is superseded by Block 9)
- ✅ Block 2 — every task done, tests as in run 1
- ✅ Block 3 — every task done, tests as in run 1
- ✅ Block 4 — every task done, tests as in run 1 (migration 0006 regenerated in place; journal `when`, snapshot and rollback agree)
- ✅ Block 5 — every task done, tests as in run 1
- ✅ Block 6 — every task done, tests as in run 1
- ✅ Block 7 — every task done, tests as in run 1
- ✅ Block 8 — every task done, tests as in run 1 (e2e 53/53, perf 5/5). Test-only table `perf_movements` is still created by the benchmark, dropped in its teardown and never part of a migration
- ✅ Block 9 — every task done (4 files, 4 exports), 6 of 6 required tests (bound, exact bound, names for create and rename, empty names, response schemas, exact sums)
- ✅ Block 10 — every task done (5 of 5), 8 of 8 required tests (use cases at 9,300 accounts, repository CHECK, routes 400 and 201, names, empty names, 9,300 accounts over HTTP, migration CHECK)
- ✅ Block 11 — every task done, 6 of 6 required tests (message mapping, containers, out-of-range amount, copy, e2e)

### Tests (run 2)
- ✅ Sad-path tests for the new inputs: opening balances one unit beyond the bound (both signs) and the int64 extremes are rejected, names with each Cc or Cf character and with only invisible or blank content are rejected for create and rename, non-integer and 41-digit amounts fail the exact schemas, the CHECK rejects out-of-range rows with 23514
- ✅ Coverage per file: no new file is below 80% in lines or functions apart from the Drizzle table definition `schema.ts` (its callbacks only run under drizzle-kit; the CHECK is proven by the migration and repository tests); branches below 80% only in defensive paths (`account-routes.ts` fail-closed guard, `delete-account.ts` find-then-delete race, `accounts-container.tsx`)
- ✅ TDD evidence for Blocks 9 to 11 (supplied from the implementer reports; the commits bundle code with tests): Block 9 red 17 of 17 new or rewritten tests (`TypeError: sumExact is not a function`, `expected true to be false` for the bound and name rules, `expected false to be true` for a balance beyond int64) plus a fix round with red `expected true to be false` for a leading byte order mark, trailing newline and leading tab; Block 10 red 5 tests (`RangeError: Amount is outside the signed 64-bit range` in `balanceOf` and the 9,300 use-case test, `expected undefined to be '23514'` in the repository and migration tests, `expected 500 to be 200` for the 9,300-account list), the remaining route and name tests were guards because Block 9 already enforced them; Block 11 red 9 tests (`nameErrorMessage` returned `nameRequired` instead of `nameInvalidCharacters`, `IntlError: MISSING_MESSAGE` for the new keys) and a follow-up red `ZodError` formatting a total of 9300000000000000000 and a balance of 9223372036854775808

### Warnings (run 2, non-blocking)
- ⚠️ The loop replaced the only test that read back a value above 2^53 (the 2^53 plus 1 repository test) by tests at 10^15; the derived-value tests use multiples of 10^15, which a float64 can represent exactly, so they would not catch a regression to float arithmetic. A cheap follow-up is a use-case test with a fake port sum of 2^53 plus 1 and an odd opening balance.
- ⚠️ Spec drift: Block 9 and Q9 say the Cc and Cf check runs after trimming; the code checks before trimming (so a name with a trailing newline or a leading tab is refused), which is stricter, matches FR-14 ("contains") and is asserted by the tests. The spec text should be amended.
- ⚠️ The web form shows the generic invalid-amount message, not the out-of-range message, for amounts above about 9.2 times 10^16 major units, because `parseAmountInput` returns null beyond int64; the API answers 400 naming the field in every case and no test covers that band.
- ⚠️ W-VER-01: `sumMinorUnits`, `addMinorUnits` and `parseMinorUnits` are now used only by tests (public shared helpers).
- ⚠️ W-VER-02: branches under 80% are defensive (`account-routes.ts:49`, `delete-account.ts:23`, `accounts-container.tsx`).
- ⚠️ W-VER-03: shared fixed e2e ports 3000, 4000 and 4100, a 9,300-row seeding test with a 60 second timeout, and the CRLF working tree make plain `pnpm lint` fail locally; all environmental.
- ⚠️ Info: `account-form.tsx`, `account-list.tsx` and `account-presenter.ts` changed without being in the Block 10 and 11 file lists (the presenter change is a comment); the Cc and Cf rule is enforced by the API schema, not by a database CHECK, which the spec does not require; any local database that applied the earlier 0006 migration must be dropped, because the unmerged migration was regenerated in place.

Result: PASSED
