# Test run DISC-001-07a

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent07a_test pnpm test:coverage` |
| Total | 1899 |
| Passed | 1899 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 97.12% |
| Branch coverage | 92.98% |
| Function coverage | 94.75% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `npx eslint .` (strictTypeChecked) and `npx prettier --check --end-of-line auto .` — clean, 0 findings; `pnpm typecheck` — clean |

## Scope

Coverage is measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as
AGENTS.md requires (143 test files). The run is on the branch `feat/DISC-001-07a-portfolios-holdings`
rebased on `origin/main` (0 commits behind at the time of the run), after all 11 blocks and the corrective loop of the VERIFY phase (commit `ffe5907`: FR-17 cost
clearing on a currency change and per-portfolio focus restore) were committed. The previous run of
this report (1884 tests) was superseded by this one. The Prettier check uses `--end-of-line auto` because this Windows checkout reports CRLF
on every file otherwise; the content check is the same.

Other suites on the same tree:
- `pnpm e2e` (Playwright) with
  `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent07a_e2e`, Mailpit and the fake
  OIDC server: 60/60 passed, including `apps/web/e2e/investments.spec.ts` (create, price, gain,
  merge, zero quantity, isolation, delete). The `--` filter of the `e2e` script did not narrow the
  run, so the whole suite ran.
- `pnpm test:perf`: the new `apps/api/test/perf/portfolio-latency.perf.test.ts` passed on its own
  (NFR-03: p95 44.27 ms against 500 ms for 10 portfolios and 500 holdings, 500 requests, 8
  connections, cold), and the whole perf suite passed 7/7 when it was run once.
- No test calls Google, CoinGecko, a broker or any other real external service.

Migration `0008_investments`: journal `idx` 8, journal `when` 1790943101410, which is greater than
the `when` of `0006_accounts` (1790895423195) and of `0007_profile_display_name` (1790891329764).

## Failures
(none)

## Skips
(none)
