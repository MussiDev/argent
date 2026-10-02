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
