# TDD evidence DISC-001-03a

Red-phase evidence per block, as reported by the implementer of each block and read by the block
verifier. Each block's tests were written first and run before the implementation existed. **What is
recorded here is what the reports contain.** Where a block's files did not even load (a missing
module, so no individual test ran), the only red result is that failure and no per-test assertion
exists; that is said explicitly below instead of being dressed up as a per-test table. The verifiers
could not reproduce any red run (the work was uncommitted when they looked); they judged the evidence
plausible against the tests and the files on disk. Paths are relative to `apps/api/test/exchange-rates`
unless stated.

## Block 1 — Shared contracts and the scaled-rate parser (7 + 6 tests)

Headline only. Both files failed at import, so none of the 13 tests ran in the red run:

| File | Red result |
|---|---|
| `packages/shared/test/scaled-rate.test.ts` (7 tests) | `Cannot find module '../src/exchange-rates/scaled-rate'` |
| `packages/shared/test/exchange-rate-schemas.test.ts` (6 tests) | `Cannot find module '../src/exchange-rates/exchange-rate'` |

After: 13/13 passed. Not red evidence: the first green attempt failed twice (zod 4 still runs a
`refine` after a failed `regex`, so `BigInt('1e3')` threw; fixed with a digits-only guard), which is a
bug found while implementing, not a failing-first test.

## Block 2 — Domain, ports and use cases (20 tests)

Headline only. Both files failed at import, none of the 20 tests ran in the red run:

| File | Red result |
|---|---|
| `rate-quote.test.ts` | `Cannot find module '../../src/exchange-rates/domain/errors'` |
| `refresh-rates.test.ts` | `Cannot find module '../../src/exchange-rates/application/get-latest-rates'` |

After: 20/20 passed. The verifier noted the tests assert specific values (the 5-minute and 60-minute
offsets, the failure code, a rethrown error with no failure record), so none of them could pass against
an empty implementation.

## Block 3 — Persistence: tables, migration 0012, repositories (30 tests plus the migration-test changes)

| Required test | File | Red result |
|---|---|---|
| `replaceAll` stores 7 rows and replaces in place; exact bigint round trip; check constraints; previous rows kept on a database error; empty table | `rate-repository.test.ts` | headline only: `Cannot find module '../../src/exchange-rates/infrastructure/db/drizzle-rate-repository'`, no test ran |
| claim, lease, two concurrent claims, `succeeded` and `failed`, stale owner | `refresh-schedule.test.ts` | headline only: `Cannot find module` for `drizzle-refresh-schedule`, no test ran |
| failure record round trip, purge | `refresh-failure-log.test.ts` | headline only: `Cannot find module` for `drizzle-refresh-failure-log`, no test ran |
| the three tables exist | `schema-introspection.test.ts` | "has the three tables" failed (tables missing) |
| no float column, no foreign key to users | `schema-introspection.test.ts` | not red evidence: both passed vacuously on missing tables and only mean something once the migration exists |
| 0012 applies, rolls back, journal order; every rollback chain starts with `rollback('0012_exchange_rates')` | `apps/api/test/identity/migration.test.ts` | 18 of 22 failed: the rollback file did not exist, and the new `describe` failed on the missing file and journal entry |

Round 2 (review fix): the new test "truncates a 300-character detail to 200 characters" failed first with check violation 23514 on `exchange_rate_refresh_failures_detail_length_check`. A test for exactly 200 characters and one for an absent detail were added and were green on first run; the old assertion that a 201-character detail is rejected was removed because `record` now truncates.

After: 183/183 in 11 files (first round), 71/71 in 8 files after round 2.

## Block 4 — Provider adapters: dolarapi and the fake (20 tests, 53 after round 2)

First round, headline only: `dolarapi-payload.test.ts` failed with `Cannot find module '.../provider/dolarapi-payload'` and `dolarapi-rate-provider.test.ts` with `Cannot find module '.../provider/dolarapi-rate-provider'`; no individual test ran. After: 20/20.

Round 2 (review fixes), the one place with per-test red evidence: 13 of 53 tests failed before the fix.

| Test | Red result |
|---|---|
| inherited `casa` values `constructor`, `toString`, `__proto__`, `hasOwnProperty` are ignored (4) | the entry was not ignored, so the mapping did not return the 7 quotes |
| non-ISO dates `2026`, `1`, `10/02/2026`, `Fri Oct 02 2026`, `2026-10-02`, `2026-10-02 11:56:00` (6) | `expected a RateProviderFailure`: they were accepted |
| content types `application/json-seq` and `application/json+garbage` (2) | `expected a RateProviderFailure`: they were accepted |
| `cancel()` rejecting with a declared `content-length` of 70000 (1) | `expected 'provider_unreachable' to be 'provider_invalid_payload'` |

Written in round 2 but already green on first run (regression coverage, not failing-first): the parser edge cases through the mapper (`1e3`, above the maximum, `0`, `-0`, `1495.00005`, `1495.0`), the mapper without the reviver failing closed, `AbortError` and `TimeoutError` mapping to `provider_timeout`, headers sent and the body stalled, a socket destroyed mid-body, an endless stream cut at the cap, valid content types, and `cancel()` rejecting on a 500. After: 95/95 in 8 files.

## Block 5 — Sync job, worker wiring and environment (22 tests)

| Required test | File | Red result |
|---|---|---|
| env defaults, `fake` accepted outside production, production passes with defaults (7 env tests) | `apps/api/test/foundation/env.test.ts` | `expected undefined to be 'dolarapi'` |
| unknown `RATE_PROVIDER`, non-URL base URL | `apps/api/test/foundation/env.test.ts` | `expected '' to contain 'RATE_PROVIDER'` (no error was thrown) |
| worker env accepts the new settings (2 tests) | `apps/api/test/foundation/worker-env.test.ts` | failed for the same cause |
| job, schedule timing, concurrency, storage error, purge, stop | `rates-sync-job.test.ts` | headline only: the suite failed with `Cannot find module '../../src/exchange-rates'`, no individual test ran |

After: 287/287 across foundation, deploy and exchange-rates (22 files), including `railway-iac.test.ts`.

## Block 6 — HTTP: the latest-rates endpoint (9 tests)

All 9 failed at setup with `TypeError: createExchangeRateRoutes is not a function`; the source-import check failed earlier with `ENOENT` on `exchange-rate-routes.ts`. The assertions of the 9 tests (7 required plus the import scan and the stripped query keys) did not run in the red run. After: 9/9, and 358/358 in the wider run (exchange-rates, accounts, foundation).

## Block 7 — Cross-cutting checks

One test was seen failing first: the `server.ts` entry scan in `request-path.test.ts` ("the API process entry does not load providers or the job: apps/api/src/server.ts") with `AssertionError: expected [ './exchange-rates' ] to deeply equal []`, before `server.ts` was changed to import the route factory directly.

Not failing-first, and said so: the architecture probes in `apps/api/test/foundation/architecture-boundaries.test.ts` and the two scans' other cases passed on first run because the ESLint boundary rules already covered the module and the sources were already clean; they lock existing behavior. The round 2 probes and scanner extensions were applied together with their tests and no separate red pass was recorded. After: 1184 tests (first run) and 1205 (after round 2) in 88 files for `apps/api` plus `packages/shared`, 0 failing.

## What this does not prove

The orchestrator and the verifiers relied on the implementers' account for every red result above. No block has a per-test red table except the round 2 fixes of Blocks 3, 4 and 5 and the single Block 7 scan. The wiring tests written after the wiring (for example the Block 6 provider-spy test, which is vacuous) are not TDD evidence.
