# Test run DISC-001-02b

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent02b_test pnpm test:coverage` |
| Total | 1833 |
| Passed | 1833 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.89% |
| Branch coverage | 92% |
| Function coverage | 94.77% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

## Scope

Final CODE run of the ticket on the tree rebased onto `origin/main` (after PR #14, DISC-001-01e).
Coverage is measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together:
121 test files, 1833 tests. Blocks 1 to 9 are committed. Other suites on the same tree:

- `pnpm e2e` (Playwright): 64/64 passed, including the 5 new categories flows, with
  `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent02b_e2e` and the shared Mailpit;
  ports 3000, 4000 and 4100 were checked free before the run.
- `pnpm test:perf`: 6/6 passed in 5 files, including registration and Google callback with seeding.

No test calls dolarapi.com, CoinGecko, Google or any other real external service.

Environment notes: the project's Postgres listens on port 5435 (docker, restarted at the start of
this session); a first full run hit one `ECONNRESET` while truncating tables right after that restart
(1 failed of 1833, in a boundaries probe unrelated to the change), and the identical re-run passed
1833/1833. The working tree has CRLF line endings, so the prettier check uses `--end-of-line auto`.

## Failures
(none)

## Skips
(none)
