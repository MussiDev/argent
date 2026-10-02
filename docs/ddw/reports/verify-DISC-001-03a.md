# Verification DISC-001-03a

One run, on commit `f356451` (CODE closeout, gates `tests` and `sast` earned). Cross-verification by
`ddw-module-verifier` (sonnet, an agent that did not write the code). It re-ran 197 tests of the new
code (14 files: exchange-rates and the two shared test files) and 169 tests of the surrounding suites
(env, worker env, architecture boundaries, migrations, deploy including `railway-iac`), serially against
`argent03a_test`, all green, and re-ran ESLint and the API typecheck, both clean. It did not re-run
the whole suite, e2e or perf; this report takes those from `docs/ddw/reports/tests-DISC-001-03a.md`
(127 files, 1678 tests, 59/59 e2e, 6/6 perf). DDW does not run the suite: the numbers below are the
account of those runs.

| Field | Value |
|---|---|
| Module | `apps/api/src/exchange-rates/**`, `packages/shared/src/exchange-rates/**`, `apps/api/src/shared/config/env.ts`, `apps/api/src/worker.ts`, migration `0012_exchange_rates` |
| Line coverage | 97.31% (the 23 new source files; the whole project 96.68%) |
| Branch coverage | 92.25% (the 23 new source files; the whole project 92.2%) |
| Function coverage | 89.71% (the 23 new source files; the whole project 93.82%) |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm --filter @pesly/api typecheck` and `pnpm typecheck` — clean; `pnpm exec prettier --check --end-of-line auto` on the changed files — clean |

The failing-first (TDD) evidence per block is in `docs/ddw/reports/tdd-DISC-001-03a.md`; it says explicitly where only a headline result exists.

Adding `env.ts` the aggregate is 97.92% lines, 94.57% branches and 91.76% functions; adding `worker.ts`
(a process entry covered by e2e, 0% in unit coverage) it is 92.48%, 93.55% and 88.64%. All stay above the floor.

## Acceptance criteria
- ✅ AC-01 — WHEN a scheduled refresh succeeds the 7 rates are stored: `refresh-rates.test.ts:171` (7 quotes, `fetchedAt`, schedule 60 minutes ahead), `rate-repository.test.ts:341` (exact buy, sell and both timestamps, replaced in place), `dolarapi-payload.test.ts:37` (exact scaled values), `rates-sync-job.test.ts:229` (real database) (`refresh-rates.ts:29-53`, `drizzle-rate-repository.ts:10-25`, `dolarapi-payload.ts:57`)
- ✅ AC-02 — IF the provider fails or times out the last rates stay and the failure is recorded: `refresh-rates.test.ts:197`, `:212`, `:227` (each case keeps the rows, records the code, retries in 5 minutes), `rates-sync-job.test.ts:241` (real database, rows identical, one failure record, no provider text in the log), `refresh-failure-log.test.ts:36`, `dolarapi-rate-provider.test.ts:87`, `:96`, `:109`, `:122`, `:128`, `:146`, `:154` (`refresh-rates.ts:41-52`)
- ✅ AC-03 — an authenticated user gets the latest rates as stored: `exchange-rate-routes.test.ts:63` (200, shared schema parse, order by rate type, exact first entry), `:79` (every rate field is a string) (`exchange-rate-routes.ts:21-31`, `get-latest-rates.ts`, `exchange-rate-presenter.ts`)
- ✅ AC-04 — IF the request carries no valid session the answer is 401 and no rates: `exchange-rate-routes.test.ts:96` (401 `UNAUTHENTICATED` with rates seeded so a leak would show) (`exchange-rate-routes.ts:21`)
- ✅ AC-05 — WHILE no refresh has succeeded the answer is an empty result: `exchange-rate-routes.test.ts:89` (200 and `{ rates: [] }`), `refresh-rates.test.ts:281`, `rate-repository.test.ts:337`

## Spec blocks
- ✅ Block 1 — every task done; the 7 required tests exist: `scaled-rate.test.ts:11` (1623.3 parses to 16233000n), `:18` (round half up), `:25` (malformed text returns null), `:31` (zero and above the maximum return null), `:39` (30-digit text), `exchange-rate-schemas.test.ts:19` (7 entries and empty array), `:28` (rejects zero rate, non-integer string and unknown rate type). The 30-digit test asserts null and checks digit preservation through `formatScaledRate`, weaker than the spec wording and accepted.
- ✅ Block 2 — every task done; the 8 required tests exist in `refresh-rates.test.ts:171,183,197,212,227,253,272,281,285` (success, not due, unreachable, timeout and status, invalid payload cases, storage error rethrown, `GetLatestRates` order and empty list, no provider dependency). Gap noted: a schedule-storage failure is untested (`fakes.ts:74` `updateError` is never set); only the `replaceAll` storage error is covered.
- ✅ Block 3 — every task done; the 13 required tests exist: `rate-repository.test.ts:341`, `:366` (exact bigint round trip of the maximum; deviation from the spec's "above the safe integer range" because the check constraint caps rates at 1e11, below 2^53), `:382` (range check rejects), `:393` (unknown rate type rejected), `:401` (a database error keeps the previous 7 rows), `:337` (empty table), `refresh-schedule.test.ts:44,54,62,78,95` (claim, lease, two concurrent claims, succeeded and failed, stale owner), `refresh-failure-log.test.ts:36,66` (round trip, purge), `schema-introspection.test.ts:26,36` (no float column, no foreign key to users), `identity/migration.test.ts:873-945` (0012 applies, rolls back, journal order). The spec's "claim true" is `Date | null` in the port and the tests assert the lease or null.
- ✅ Block 4 — every task done; the 9 required tests exist: `dolarapi-payload.test.ts:37,50,62,72,84,95`, `dolarapi-rate-provider.test.ts:87,96,109,122,128,146,265,273` (fixture mapping, rate-type mapping, null and negative prices, missing type and duplicate, bad date, HTTP 500, 302 not followed, closed port, timeout, oversize body and wrong content type, the fake).
- ✅ Block 5 — every task done; the 11 required tests exist: `rates-sync-job.test.ts:229,241,264,283,296,334,358` (due refresh with the fake, failing provider, 59 versus 60 minutes, two concurrent jobs, storage error, purge, stop during a refresh), `env.test.ts:229-286`, `worker-env.test.ts:33-54`; `railway-iac.test.ts` still passes with `.railway` untouched.
- ✅ Block 6 — every task done; the 7 required tests exist: `exchange-rate-routes.test.ts:63,89,96,104,114,123,79` (7 rates with scaled strings, empty store, 401, 403, 500 with only a code, the provider spy, schema-valid body with no numeric rate).
- ✅ Block 7 — every task done; the 4 required tests exist: `no-float-rates.test.ts:428-467`, `request-path.test.ts:86-165`, `architecture-boundaries.test.ts:133-167`, and the whole API suite (127 files, 1678 tests) in the CODE closeout.

## Tests
- ✅ Sad-path tests: `parseScaledRate` (`scaled-rate.test.ts:25,31,39`); the provider adapter (`dolarapi-rate-provider.test.ts:87,96,109,122,128,136,146,154,164,185,196,210,227,236,246`); the payload mapper (`dolarapi-payload.test.ts:62,72,84,95,101,110,118,143,156`); environment parsing (`env.test.ts:248-276`, `worker-env.test.ts:52-54`); the route (`exchange-rate-routes.test.ts:96` 401, `:104` 403, `:114` 500, `:148` unknown query keys stripped); repositories (`rate-repository.test.ts:382,393`).
- ✅ Spec tests: every test named under each block's "Required tests" exists and passes (see the blocks above); the two deviations are recorded there.
- ✅ NFR-01 no float: bigint columns (`drizzle/0012_exchange_rates.sql`), `schema-introspection.test.ts:26`, `no-float-rates.test.ts:462`, the reviver keeps source text only (`dolarapi-payload.ts:28-32`), string-typed response (`exchange-rate-routes.test.ts:79`).
- ✅ NFR-02 60-minute schedule: `REFRESH_INTERVAL_MS` (`refresh-rates.ts:9`), `refresh-rates.test.ts:171`, `refresh-schedule.test.ts:62`, `rates-sync-job.test.ts:264,283`; proven with an injected clock.
- ✅ NFR-03 zero provider calls in the request path: the provider is built only in `worker.ts:29-32`, `server.ts` deep-imports the route factory, and the import scans (`request-path.test.ts:152,159`, `exchange-rate-routes.test.ts:134`) plus the dependency-keys test (`refresh-rates.test.ts:285`) prove it.

## Warnings (did not block)
- ⚠️ W-VER-01: `formatScaledRate` and `RATE_SCALE` have no production caller (`packages/shared/src/exchange-rates/scaled-rate.ts:2,30`); `DOLARAPI_BASE_URL_DEFAULT` is exported but used only in `env.ts:46`; the barrel exports `createExchangeRateRoutes` and `RatesSyncJob` that nothing in production imports through it (`apps/api/src/exchange-rates/index.ts:14-16`); `InMemoryRefreshSchedule.updateError` is never set (`fakes.ts:74`).
- ⚠️ W-VER-02: module function coverage is 89.71%, below 90% for business logic: `dolarapi-rate-provider.ts` 77.8% functions (the `.catch(() => undefined)` callbacks), `schema.ts` 16.7% (declarative builder callbacks), `drizzle-rate-repository.ts` 50% branches (the empty-list early return), `rates-sync-job.ts` 87.5% branches.
- ⚠️ W-VER-03: `rates-sync-job.test.ts:217` polls with 5 ms real timers for up to 2 s and `:381` waits a fixed 60 ms for a negative assertion (it can pass vacuously, not flake red); `rates-sync-job.test.ts:387` relies on the wall clock with a 1 s bound; the suite relies on per-test table truncation and serial execution, as the rest of the repository does.
- ⚠️ The Block 6 provider-spy test is vacuous (the spy is never wired; `exchange-rate-routes.test.ts:123-132`); the real NFR-03 proof is structural (above). Follow-up: rename or replace it so it claims no more than it proves.

## Follow-ups (open advisories, none violates an AC or an NFR, judged by the verifier)
- `apps/api/src/worker.ts:44`: `Promise.all` over the two `stop()` calls would skip `pool.end()` if one rejected; `RatesSyncJob.stop()` cannot reject today and the shutdown helper exits the process anyway.
- `apps/api/src/exchange-rates/infrastructure/jobs/rates-sync-job.ts`: a `start()` straight after `stop()` could overlap two loops; production never restarts the job.
- `apps/api/src/exchange-rates/application/refresh-rates.ts:36-39`: `replaceAll` is not guarded by the lease, so a refresh outliving its 5-minute lease could overwrite fresher rates; the provider timeout is 10 seconds (SAST I-3).
- `GET /exchange-rates/latest` sets no `Cache-Control`; no AC or NFR mentions caching, and the PWA's offline cache (PRD 04) should decide.
- Add a test for a schedule-storage failure in `RefreshRates`, and cover the `replaceAll([])` early return.

Result: PASSED
