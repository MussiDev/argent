# Verification DISC-001-03b

| Field | Value |
|---|---|
| Module | apps/api/src/movements, packages/shared/src/movements, apps/web/src/features/movements |
| Line coverage | 97.27% |
| Branch coverage | 92.78% |
| Function coverage | 95.04% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm typecheck` — clean; `prettier --check --end-of-line auto` on every changed file — clean |

Whole-module cross-check by an independent verifier that did not write the code (agent `ddw-module-verifier`), against the PRD, the spec, the TDD report, the test report and the SAST report. The coverage numbers and the perf figures (accounts list p95 37.5 ms, saving a movement p95 80.2 ms, limit 300 ms) are the account of the full run in `docs/ddw/reports/tests-DISC-001-03b.md` (3325 of 3325 passed, 76 of 76 e2e); the verifier re-ran the movements tests (372 and 155 tests, all green), typecheck and eslint, and did not re-run the whole suite, e2e or perf.

Decision note: decisions D1 (no idempotency key on create, accepted as a known limitation, follow-up owned by the PRD 04 offline sync ticket) and D2 (the list shows the frozen rate only on USD-account rows) are recorded in the spec section "Decisions recorded during CODE" and in the TDD report. By human decision of 2026-10-02 the PRD decision log is not updated: no requirement or acceptance criterion changed.

## Acceptance criteria
- ✅ AC-01 — `CreateMovement.execute` (apps/api/src/movements/application/create-movement.ts); route test `creates an expense and an income and lists them newest first`
- ✅ AC-02 — `movementAmountSchema` (packages/shared/src/movements/movement.ts); route test `answers 400 VALIDATION_FAILED naming body.amount for an amount of 0 and stores nothing`
- ✅ AC-03 — `CreateMovement.execute` kind check; test `rejects the wrong category kind and stores nothing`
- ✅ AC-04 — `CreateMovement.execute`; route test `creates an expense and an income and lists them newest first`
- ✅ AC-05 — `CreateMovement.execute`; route test `answers 400 MOVEMENT_CATEGORY_KIND_MISMATCH for a category of the other kind`
- ✅ AC-06 — `CreateMovement.execute` rate branch; route test `returns the stored rate and source: automatic with the default type sell price, manual as typed`
- ✅ AC-07 — `DrizzleRateLookup.latestSell`; web container test `prefills the default rate type sell price and sends an automatic rate`
- ✅ AC-08 — `parseRateInput`; container test `sends a manual rate when the prefilled value is edited, even back to the same value`
- ✅ AC-09 — rate schema; route test `answers 400 VALIDATION_FAILED for a manual rate of 0`
- ✅ AC-10 — no key to exchange_rates; route test `keeps the saved rate when the stored rates refresh afterwards`
- ✅ AC-11 — `rateAgeMs` (packages/shared/src/movements/rate-age.ts); e2e `after the stored rates age in the database the screen shows the age message`
- ✅ AC-12 — `sumsByAccount` (drizzle-account-movements.ts); test `balance is opening plus incomes minus expenses` in account-obligations.test.ts
- ✅ AC-13 — `sumsByAccount`; real-adapters.test.ts `income minus expense per account`
- ✅ AC-14 — repository `list`; route test `pages by 50 by default, accepts limit 100 and rejects 101`
- ✅ AC-15 — `CreateMovement.execute` with `dateInTimeZone`; route test `answers 400 MOVEMENT_DATE_IN_FUTURE for a local date after today`
- ✅ AC-16 — `notFoundUnlessAllowed`, `scopedTo`; route test `answers 404 NOT_FOUND for another user's account, category and movement`
- ✅ AC-17 — repository `list` with `scopedTo`; same route test and `never returns another owner's rows`
- ✅ AC-18 — `hasMovements` plus the RESTRICT key; account-obligations.test.ts delete test (409 ACCOUNT_HAS_MOVEMENTS)
- ✅ AC-19 — `isUsed` plus the RESTRICT key; category-obligations.test.ts (409 CATEGORY_IN_USE)
- ✅ AC-20 — `RateRequired` in create-movement.ts; container test `leaves the rate empty and required with no stored rate`
- ✅ AC-21 — `RateRequired`; test `fails with RateRequired` and the route test for RATE_REQUIRED then a manual rate accepted
- ✅ AC-22 — `eraseUserMovements` and the ordered step; erasure-step.test.ts `leaves no movement, rate-limit window, account or category of the user`
- ✅ AC-23 — ordered step in one transaction; erasure-step.test.ts `rolls the whole deletion back when the movements delete fails`
- ✅ AC-24 — `sumsByAccount` into the totals; totals.test.ts (Available and Net worth)
- ✅ AC-25 — `MovementAccountArchived`; route test and e2e archived-account flow
- ✅ AC-26 — `CategoryArchived`; route test for 409 CATEGORY_ARCHIVED
- ✅ AC-27 — archived checks; route test 201 after unarchiving and e2e
- ✅ AC-28 — `RecordManualMovement.execute`, `DrizzleMovementWriteLimiter`; route test `answers 429 RATE_LIMITED with Retry-After on the 61st creation`
- ✅ AC-29 — same; route test (accepts again next minute)
- ✅ AC-30 — `CreateMovement` never touches the limiter; record-manual-movement.test.ts `CreateMovement called directly is never counted`
- ✅ AC-31 — `instantToZonedLocal`, `zonedLocalToInstant`; container test `turns an edited local date and time into the matching UTC instant` and zoned-time.test.ts

## Spec blocks
- ✅ Block 1 — shared contracts and helpers: movement-schemas, rate-age, zoned-time and rate-input tests; every task done and every promised test present and passing
- ✅ Block 2 — domain, ports and use cases: create-movement, record-manual-movement and list-and-get-movement tests; every task done and every promised test present and passing
- ✅ Block 3 — persistence, migration 0014 and the repository: movement-repository, schema-introspection and the 0014 describe in migration.test.ts; every task done and every promised test present and passing
- ✅ Block 4 — lookups, real adapters and the limiter: lookups, real-adapters and write-limiter tests; every task done and every promised test present and passing
- ✅ Block 5 — HTTP and composition: movement-routes and error-handler tests; every task done and every promised test present and passing
- ✅ Block 6 — ordered erasure step, guard and import rule: erasure-step, deletion-persistence, user-erasure and architecture-boundaries tests; every task done and every promised test present and passing
- ✅ Block 7 — obligations of 02a and 02b, totals and performance: account-obligations, category-obligations, totals, movements-save.perf and accounts-list.perf tests; every task done and every promised test present and passing
- ✅ Block 8 — web client and the entry screen: movements-containers, movements-components, api-client-movements, i18n-catalogs and routes tests; every task done and every promised test present and passing
- ✅ Block 9 — movements list screen and navigation: movements-list, authenticated-shell-container and routes tests; every task done and every promised test present and passing
- ✅ Block 10 — end to end flow and cross-cutting scans: movements.spec.ts, no-float-money, request-path and architecture probes; every task done and every promised test present and passing

## Tests
- ✅ Sad-path tests: every input has an invalid-input test: the create body (amount 0, negative, over 10^15, rate 0, malformed instant, note over 500, wrong ids and kinds), the paging query (limit 101, 0, negative offset), the id parameter (`/movements/not-a-uuid` answers 400, unknown id 404), and the web form (no request is sent for any invalid value)
- ✅ Coverage: 97.27% lines, 92.78% branches, 95.04% functions, all above the 80% floor

## Warnings (do not block)
- ⚠️ W1: the 99 "Required tests" checkboxes of the spec stay unticked (the evidence is in the TDD report, as in the 02b spec).
- ⚠️ W2: `apps/api/test/movements/erasure-step.test.ts:150` waits 300 ms for the erasure to reach the lock and `:186` has a vacuous size assertion.
- ⚠️ W3: a few value exports have no importer outside their file (`MOVEMENT_WRITE_WINDOW_SECONDS`, `movementTypeSchema`, `listMovementsQuery` and similar).
- ⚠️ W4: `investments-migration.test.ts` and `migration.test.ts` list 0014 by name, so the next migration ticket edits both.
- ⚠️ W5: some blocks have load-failure-only red evidence, and a few tests had no observable red run (disclosed in the TDD report).
- ⚠️ W6: carried advisories (hardcoded `+` sign, duplicated default time zone, no container test for the repeated DST hour).

Result: PASSED
