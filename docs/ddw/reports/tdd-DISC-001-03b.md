# TDD evidence DISC-001-03b

Red-phase evidence per block, written block by block as the work happens, from the implementer's report of each block and
checked by that block's verifier. Where a test file could not even load (a missing module or export, so no individual assertion
ran) the red result is that failure and no per-assertion line exists; this is said explicitly. Paths are relative to the repository
root.

## Block 1 — Shared contracts and helpers (27 tests)

All four new test files failed before the implementation existed because the exports they import were undefined, so no individual
assertion ran in the red run; each failed with a `TypeError` on the missing export.

| Test file | Tests | Red result |
|---|---|---|
| `packages/shared/test/movement-schemas.test.ts` | 12 | `TypeError: Cannot read properties of undefined (reading 'safeParse')` (the schemas did not exist) |
| `packages/shared/test/rate-age.test.ts` | 3 | undefined-export `TypeError` (`rateAgeMs`, `RATE_AGE_BASIS`) |
| `packages/shared/test/zoned-time.test.ts` | 9 | undefined-export `TypeError` (`todayInTimeZone`, `dateInTimeZone`, `zonedLocalToInstant`, `instantToZonedLocal`) |
| `packages/shared/test/rate-input.test.ts` | 3 | undefined-export `TypeError` (`parseRateInput`, `formatRateInput`) |

After: 27/27, shared suite 63/63, `pnpm typecheck` clean. The first implementation run was green.

Round 2 (review fixes): two tests failed first (2 failed, 63 passed). `parseRateInput('1623.3', 'x')` threw `RangeError: Incorrect locale information provided` (a malformed locale tag must not throw); and the NFC/NFD note test failed with `expected 'café' to be 'café'` (the NFD form was stored as typed). Both were then fixed (the rate-input separators fall back and are cached per locale, the note is NFC-normalized); the zone-validation memo added in the same round changes no observable behavior and has no new test. After: shared suite 65/65.

## Block 2 — Domain, ports and use cases (31 tests)

The three new test files failed before the implementation existed because their imports could not load, so no individual assertion ran
in that red run:

| Test file | Tests | Red result |
|---|---|---|
| `apps/api/test/movements/create-movement.test.ts` | 13 | `Cannot find module '../../src/movements/application/create-movement'` |
| `apps/api/test/movements/record-manual-movement.test.ts` | 15 | the same module error |
| `apps/api/test/movements/list-and-get-movement.test.ts` | 3 | `Cannot find module '../../src/movements/application/get-movement'` |

Round 2 (review fixes, the one place with per-test red evidence): 5 tests failed first.

| Test | Red result |
|---|---|
| a note empty or only whitespace is stored as null | `expected '' to be null` |
| the original creation error propagates when `release` fails and the failure is reported | `expected [] to deeply equal [Error: release failed]` (the failure was swallowed without a report) |
| the original 429 propagates when `release` fails and the failure is reported | the same assertion |
| the original error propagates and is reported when `release` throws synchronously | `expected Error: sync release failed to match object { code: 'RATE_REQUIRED' }` (a synchronous throw had replaced the original error) |
| the retry seconds are capped at the window length under a skewed clock | failed for a test bug on its first version (the request was allowed); the corrected test was not re-run before the cap existed, so its red result is by the formula (660 seconds), not observed |

Written in round 2 and green on first run (regression coverage, not failing-first): `limiter.record` rejecting propagates the error and
never calls `release`; when the window rolls over while the creation fails, `release` receives the original reservation's window start.

After: 31/31 in the three files; with the shared suite 96/96. `pnpm typecheck` clean.

## Block 3 — Persistence: relations, migration 0014 and the repository (33 new tests plus 5 in `migration.test.ts`)

| Test file | Tests | Red result |
|---|---|---|
| `apps/api/test/movements/movement-repository.test.ts` | 25 | headline only: the suite failed to load, `Cannot find module '../../src/movements/infrastructure/db/drizzle-movement-repository'`, so none of its tests ran |
| `apps/api/test/movements/schema-introspection.test.ts` | 9 | 7 of 9 failed, for example `has both tables: expected [] to deeply equal ['movement_rate_limits', 'movements']` and `unique constraint: expected [] to have a length of 1`; the two that passed (no float column, no key to `exchange_rates`) were vacuously true on an empty set, and the first test guards them |
| `apps/api/test/identity/migration.test.ts` | 5 new, the rest adjusted | with the 0014 journal entry removed, 33 tests failed, for example `expected 13 to be 14` and `expected [... 17 tables] to deeply equal [... 19]`; the journal was restored afterwards |
| `apps/api/test/deploy/build-output.test.ts` | table list extended | not shown failing first: it was edited and run together (it compares the list after migrating) |

Round 2 (review fixes), per-test red evidence:

| Test | Red result |
|---|---|
| the list query can use `movements_owner_date_idx` for its ordering with no sort step (30 seeded rows, `analyze`, `explain` with `enable_seqscan` and `enable_sort` off) | `expected 'Limit (cost=10000000013.31..…' not to match /Sort/`: the plan was `Sort (Sort Key: occurred_at DESC, id DESC)` over an index scan, because the repository's `desc()` ordered `NULLS FIRST` while the index is `NULLS LAST` |
| the insert ignores a smuggled id, owner and timestamps | `expected '11111111-1111-4111-8111-111111111111' not to be '11111111-1111-4111-8111-111111111111'` (the smuggled id was stored, because the insert spread its input) |

The first draft of the index test had a regular expression that silently contained backspace characters, so it passed against the old ordering; it was corrected and the red result above is from the corrected test.

Migration generation: the journal `when` is 1790966184307 (generated, greater than 0013's 1790962588595); the 0014 snapshot `prevId` equals 0013's snapshot id; `drizzle-kit check` is clean; a second `drizzle-kit generate` reported no schema changes. The one hand edit is the position of the `accounts_id_owner_unique` statement before the composite keys (drizzle-kit emitted it after them), documented in the SQL header.

After: 432/432 in 14 files (movements, migration, build-output, accounts, categories); typecheck clean.


## Block 4 — Lookups, real adapters and the creation limiter (23 new tests)

| Test file | Tests | Red result |
|---|---|---|
| `apps/api/test/movements/lookups.test.ts` | 9 | headline only: the suite failed to load, `Cannot find module` for the lookup adapters, so no assertion ran |
| `apps/api/test/movements/real-adapters.test.ts` | 7 | headline only: `Cannot find module` for `createAccountMovements` / `createCategoryUsage` |
| `apps/api/test/movements/write-limiter.test.ts` | 7 | headline only: `Cannot find module` for the limiter |

The implementer reported 22 tests; the verifier counted 23 (9 + 7 + 7), which is the number on disk and the number that passes.

Review: verifier PASS, auditor no blockers. Advisories left as they are: the default time zone constant is duplicated from shared (candidate to export from shared later), chunk size of 500 is not pinned by a spy, and `new Date()` seeds one limiter test clock (frozen, so not flaky).

After: 401/401 in 15 files (movements, accounts, categories); typecheck, eslint and prettier clean.

## Block 5 — HTTP routes and composition (24 route tests, 5 error-handler tests)

| Test file | Tests | Red result |
|---|---|---|
| `apps/api/test/movements/movement-routes.test.ts` | 24 | headline only: the suite failed to load, `Failed to resolve import '../../src/movements'`, so no test ran (the mass-assignment test was added after review, run green on first write: the stripping schema and the handler's field-by-field pick already guarantee it) |
| `apps/api/test/foundation/error-handler.test.ts` | 5 new | 1 of 5 failed first: `maps a RetryableError to 429 with a Retry-After header` with `expected undefined to be '42'`; the 4 code-mapping tests passed before implementation because Block 1 had already registered the codes, so they are regression guards |

Out-of-block fix: `apps/api/test/investments/investments-migration.test.ts` (07a's test) assumed 0013 was the newest migration and failed once 0014 existed (4 tests). It now rolls back later migrations first and expects them back after the replay. Run green on its own database: 4/4.

Review: verifier PASS, auditor no blockers. Advisories left: `clock` option added to `createMovementRoutes` (spec wording to update), barrel uses `export *` for the routes file, release-failure logging has no test, `err` logged raw (logger redaction to confirm in SAST).

Known red until Block 6: `apps/api/test/identity/user-erasure.test.ts` (5 tests), because the erasure guard now sees the movements relations without the `erase-step` policy.

## Block 6 — Ordered erasure step, guard policy and import rule

| Test file | Result before implementation |
|---|---|
| `apps/api/test/identity/user-erasure.test.ts` | the original file had 5 failing guard tests (movements relations unregistered, composite keys non-cascading); after registering them 11 of 12 passed with no step, because a bare delete of the user happens to work, so the route test now spies on the step and failed with `expected "vi.fn()" to be called 1 times, but got 0 times` |
| `apps/api/test/identity/deletion-persistence.test.ts` | 2 of 21 failed: `expected [] to deeply equal [ …(2) ]` (steps ignored) and `promise resolved "'erased'" instead of rejecting` (a failing step did not abort); the third new test (abort before steps) passed, as no step existed |
| `apps/api/test/movements/erasure-step.test.ts` | 3 of 7 failed: `eraseUserMovements is not a function` (2) and the `server.ts` source check `expected ... to match /beforeUserErased/`; the 4 integration tests passed before, because a bare delete works here |
| `apps/api/test/foundation/architecture-boundaries.test.ts` | 13 of 92 failed: `expected [] to deeply equal ['no-restricted-imports']` (identity, accounts and categories could import movements) |

Fact recorded: a bare `delete from users` with movements present succeeds, by the order PostgreSQL fires referential triggers; the step is the contract and the guard keeps the `erase-step` policy.

Review: verifier PASS, auditor no blockers. Advisories left: the guard cannot itself prove the step is wired (the `server.ts` source check does), the ESLint regex only names the four layer folders, two timing and weak assertions in the race tests, and a rare 40P01 between an erasure and a concurrent account delete (retryable). Comments added about the trigger-order assumption and the lock.

After: 120 files, 2014 tests in `apps/api` pass; typecheck, eslint and prettier clean.

## Block 7 — Obligations of 02a/02b, FEAT-003 totals and performance (12 tests)

No production code changes in this block: Blocks 4 and 5 already satisfy every test, so none could fail first. Red evidence was obtained by temporarily swapping the real adapters in the test harness for `NoMovementsAdapter` and `NoUsageAdapter` (harness restored afterwards); the perf files were not run that way.

| Test file | Tests | Result with the No* adapters |
|---|---|---|
| `apps/api/test/movements/account-obligations.test.ts` | 4 | 1 red: archive keeps the balance `expected '1000' to be '700'`; balance formula `expected '2500' to be '11950'` |
| `apps/api/test/movements/category-obligations.test.ts` | 4 | 0 red: the foreign key restrict maps to the same 409/404 codes, so these cannot detect an unwired adapter; the wiring is pinned by the `server.ts` source check in `erasure-step.test.ts` (comment added in both files) |
| `apps/api/test/movements/totals.test.ts` | 2 | 1 red: `expected { available: 50000n, netWorth: 70000n } to deeply equal { available: 40000n, netWorth: 60000n }` |
| `apps/api/test/perf/movements-save.perf.test.ts` | 1 | not run with No*: nothing to fail against; asserts 500 saved rows exist so a 201 without an insert cannot pass |
| `apps/api/test/perf/accounts-list.perf.test.ts` | modified | now uses the real adapter on a real movements table (100 accounts, 100,000 movements) and asserts balances and totals against a JS formula |

Perf (threshold p95 under 300 ms, 500 requests, 20 warm-up, 8 connections): accounts list 37.5 ms, saving a movement 80.2 ms.

Review: verifier PASS, auditor no blockers. Fixed after review: the shared fixture `newCategory` used an icon outside the public palette (now `wallet`), a vacuous assertion removed. Advisories left: the harness does not pass the identity hooks (`seedDefaultCategories`, `beforeUserErased`) so the router list is duplicated by hand across `server.ts`, the harness and the perf test; perf helpers duplicated across perf files; fixed emails in perf seeds.

## Block 8 — Web client and the entry screen (103 new tests)

| Test file | Tests | Red result |
|---|---|---|
| `apps/web/test/api-client-movements.test.ts` | 20 | 20 of 20 failed: `client.createMovement is not a function` (and the same for `listMovements`, `getLatestRates`) |
| `apps/web/test/i18n-catalogs.test.ts` | 7 new | 7 of 7 new failed: `actual value must be number or bigint, received undefined` (keys missing); the 30 existing passed |
| `apps/web/test/movements-components.test.tsx` | 25 | load failure: `Failed to resolve import ../src/features/movements/format-rate` |
| `apps/web/test/movements-containers.test.tsx` | 50 | load failure: `Failed to resolve import ../src/features/movements/containers/create-movement-container` |
| `apps/web/test/routes.test.tsx` | 1 new | load failure: `Failed to resolve import .../movements/new/page` (the 17 existing could not run) |

Deviations from the spec's file list (accepted by the verifier): client tests live in a new file `api-client-movements.test.ts`; two extra presentational files `movement-field.tsx` and `movement-saved.tsx`; the container reuses `AccountsLoadStateView`. After saving, the screen shows the frozen rate and a link to the list instead of navigating by itself.

Review: verifier PASS, auditor no blockers. Added after review: a `pending` guard against double submit. Advisories left: duplicated field wrapper and focus hook (accounts, categories, movements), no idempotency key (a lost response followed by a retry could create a duplicate; to confirm as an accepted limitation), validation logic could move out of the container, no container test for the repeated DST hour.

After: 8 web test files, 320 tests green in the narrow run; typecheck and eslint clean.

## Block 9 — Movement list screen and navigation (10 tests, plus 6 after review)

| Test file | Tests | Red result |
|---|---|---|
| `apps/web/test/movements-list.test.tsx` | 8, then 6 more (14) | load failure: `Failed to resolve import ../src/features/movements/containers/movements-container`, 0 ran |
| `apps/web/test/routes.test.tsx` | 1 new | load failure: `Failed to resolve import ../src/app/[locale]/(app)/movements/page` (existing tests could not run) |
| `apps/web/test/authenticated-shell-container.test.tsx` | 1 new | `Found multiple elements with the role link` (the nav key was undefined) |

Review round 1 additions (red where it could be): dedupe by id on show more `expected [...] to have a length of 101 but got 102`; invalid profile zone `RangeError: Invalid time zone specified: Not/AZone`; list role `expected null to be 'list'`. Three more tests lock existing behavior and had no red run: exactly six requests on load, 401 during show more, accounts and categories paging beyond 100 with the stale-total exit. The generation counter against a stale show-more response has no test (the UI cannot trigger the race) and the pending `aria-busy` value is not asserted (the stub cannot hold a response open).

Review: verifier PASS, auditor no blockers. Advisories left: `loadAll` duplicated with the create container, the "unreachable" type-narrowing guard, a hardcoded `+` sign, eager fetch of the archived pages, no `sr-only` type label.

After: 4 web files, 81 tests green; typecheck, eslint and prettier clean.

## Block 10 — End-to-end flow and cross-cutting scans

Blocks 1-9 already exist, so the e2e flows and scans could not start red. Red evidence came from probes and two deliberate temporary breaks (both restored with `git checkout`).

| Check | Red result |
|---|---|
| provider scanner probe in `apps/api/test/movements/request-path.test.ts` | `the provider scanner flags import type { RateProvider } from '.../ports/rate-provider'`: `expected [] to not deeply equal []`; the scanner pattern was fixed, 105 of 105 pass |
| temporary `Number('1')` appended to `apps/web/src/features/movements/format-rate.ts` | `has no float constructs: format-rate.ts: Number(: expected ['Number('] to deeply equal []` (in `no-float-money.test.ts`, 48 tests) |
| temporary `RATE_AGE_WARNING_MS` 2 h to 200 h | the age e2e failed: `expect(locator).toBeVisible() failed ... element(s) not found` |

Files: `apps/web/e2e/movements.spec.ts` (5 flows: main, no stored rate, rate age, archived account with a second tab, validation), `apps/web/e2e/support/database.ts` (exports `withE2eDatabase`, adds `withoutStoredRates`, `withAgedRates`, `movementsOf`; the restore runs in `finally`), `apps/api/test/movements/{no-float-money,request-path}.test.ts`, probe block in `architecture-boundaries.test.ts`.

Review: verifier PASS, auditor no blockers. Fixed after review: `withAgedRates` now sets `fetched_at = now() - hours` (absolute) instead of subtracting from the existing value, which could have rendered 6 hours instead of 5; the "fresh rates show no message" assertion now matches any hour count. Re-run green: age and archived flows. Advisories left: the scanners are regex based (known gaps: `'a//b'` strings hiding a line, `parseInt`, path aliases), the response guard ignores `/auth/` statuses, `API_URL` duplicated from the Playwright config, 105 per-file scan cases.

Port check before each e2e run: 3000, 4000 and 4100 were free.

## Decision D2 (after CODE closeout) — the list hides the frozen rate on ARS-account rows

Human decision of 2026-10-02: the movements list shows the frozen rate only on USD-account rows; ARS-account movements still store it and keep showing it in the post-save view. Display only, no API change.

| Test | Red result (before the change to `movement-row.tsx`) |
|---|---|
| `apps/web/test/movements-list.test.tsx` › lists movements newest first with names, amounts and currencies, the frozen rate only on the USD row | `AssertionError: expected <p …(1)></p> to be null` (the ARS row still showed the rate line) |
| `apps/web/test/movements-list.test.tsx` › formats in the active locale (one ARS and one USD movement) | `expected [ <p …(1)></p>, <p …(1)></p> ] to have a length of 1 but got 2` |

A first draft of the "no rate wording" assertion used the wrong word (`Tasa|Rate`, the catalog says `Cotización`); it was corrected before the red run quoted above. After the change: `movements-list.test.tsx` and `routes.test.tsx` 33 of 33 pass; the movements e2e was updated (the ARS list rows now assert that no rate wording appears, the stored rate is still asserted in the database) and passes 5 of 5 (ports 3000, 4000, 4100 free, Mailpit up); typecheck, eslint and prettier clean. Test counts are unchanged (two tests changed, none added): the 3325-test run in `docs/ddw/reports/tests-DISC-001-03b.md` stays accurate.

Decision D1 (no idempotency key, accepted as a known limitation, follow-up owned by the PRD 04 offline sync ticket) needs no code or test.
