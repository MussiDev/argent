# Test run DISC-001-03a

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent03a_test pnpm test:coverage` |
| Total | 2051 |
| Passed | 2051 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.82% |
| Branch coverage | 91.94% |
| Function coverage | 94.44% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto` on every file changed by the branch — clean; `pnpm typecheck` — clean |

## Scope

Closeout run of the ticket on the tree rebased onto `origin/main` after the merge of DISC-001-02b (PR #15,
migration 0009), measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md
requires: 135 test files, 2051 tests. The first closeout run (before the rebase, tree of commit `c3f8a36`)
had 127 files and 1678 tests, all green, with 96.68% lines, 92.2% branches and 93.82% functions; the rebase
brought 02b's tests in and required merging `apps/api/test/identity/migration.test.ts` by hand (see the PR
description). The per-block runs of Blocks 1 to 7 and the round 2 fixes were green before that, and every
block's tests were seen failing before its implementation (the TDD evidence is in
`docs/ddw/reports/tdd-DISC-001-03a.md`).

Other suites run on the same tree:

- `pnpm e2e` (Playwright): 64/64 passed on the rebased tree (59/59 before the rebase) with
  `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent03a_e2e` and the shared Mailpit;
  ports 3000, 4000 and 4100 were checked free before the run. The worker started with
  `RATE_PROVIDER=fake` (set in `playwright.config.ts`).
- `pnpm test:perf`: 6/6 passed in 5 files (run before the rebase; no code of the perf paths changed in it).

No test calls dolarapi.com, CoinGecko, Google or any other real external service: the provider
adapter is tested against a local `node:http` stub on 127.0.0.1 and a recorded fixture, and every
other test uses the fake provider.

Environment notes: this machine's Postgres for the project listens on port 5435, so every command set
the database variables explicitly. After the rebase the test database `argent03a_test` was dropped and recreated: it had 0012 applied, so the migrator (which applies only migrations newer than the last one recorded) never applied 0009 on it. Parallel runs against the same test database collide (the setup
truncates every table before each test), so suites were run serially. The working tree has CRLF line
endings (Windows `core.autocrlf`), so `pnpm lint` as written (`prettier --check .` with the
repository's `endOfLine: lf`) fails on untouched files; the check above uses `--end-of-line auto`.
The committed blobs are LF.

## Failures
(none)

## Skips
(none)
