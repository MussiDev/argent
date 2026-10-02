# Test run DISC-001-03a

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent03a_test pnpm test:coverage` |
| Total | 1678 |
| Passed | 1678 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.68% |
| Branch coverage | 92.2% |
| Function coverage | 93.82% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto` on every file changed by the branch — clean; `pnpm typecheck` — clean |

## Scope

Closeout run of the ticket on the tree after Block 7 (commit `c3f8a36`), measured over `apps/api/src`,
`apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 127 test files, 1678 tests.
The per-block runs of Blocks 1 to 7 and the round 2 fixes were green before this run, and every
block's tests were seen failing before its implementation (the TDD evidence is in each block's
report to the orchestrator: new test files failed with a missing module, missing relation or missing
setting).

Other suites run on the same tree:

- `pnpm e2e` (Playwright): 59/59 passed with
  `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent03a_e2e` and the shared Mailpit;
  ports 3000, 4000 and 4100 were checked free before the run. The worker started with
  `RATE_PROVIDER=fake` (set in `playwright.config.ts`).
- `pnpm test:perf`: 6/6 passed in 5 files.

No test calls dolarapi.com, CoinGecko, Google or any other real external service: the provider
adapter is tested against a local `node:http` stub on 127.0.0.1 and a recorded fixture, and every
other test uses the fake provider.

Environment notes: this machine's Postgres for the project listens on port 5435, so every command set
the database variables explicitly. Parallel runs against the same test database collide (the setup
truncates every table before each test), so suites were run serially. The working tree has CRLF line
endings (Windows `core.autocrlf`), so `pnpm lint` as written (`prettier --check .` with the
repository's `endOfLine: lf`) fails on untouched files; the check above uses `--end-of-line auto`.
The committed blobs are LF.

## Failures
(none)

## Skips
(none)
