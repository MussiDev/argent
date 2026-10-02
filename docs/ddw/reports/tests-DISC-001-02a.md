# Test run DISC-001-02a

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent02a_test pnpm test:coverage` |
| Total | 1372 |
| Passed | 1372 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.75% |
| Branch coverage | 92.2% |
| Function coverage | 94.14% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

## Scope

This is the second run of the ticket: the first one (1175 tests) was the original CODE closeout, and
this one re-earns the gates after the corrective loop for the human decisions L-1 (opening balance
bound and exact totals) and I-2 (control and format characters in names), and it is the final run on
the tree merged with `origin/main` (DISC-001-01d with migration 0007 and FIX-005). Coverage is measured over
`apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 110 test
files, 1372 tests. Every suite below ran on the tree of merge commit `3f301e0` (Blocks 1 to 11 plus
main):

- `pnpm e2e` (Playwright): 56/56 passed, the 9 accounts flows (3 new ones for the balance limit and
  the invisible-character names) plus the earlier identity flows, with
  `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent02a_e2e` (dropped and recreated
  first, because the regenerated unmerged migration 0006 had a different hash) and the shared Mailpit;
  ports 3000, 4000 and 4100 were checked free before the run.
- `pnpm test:perf`: 6/6 passed in 5 files, including the accounts list benchmark.

No test calls dolarapi.com, CoinGecko, Google or any other real external service.

Environment notes: this machine's Postgres for the project listens on port 5435 (port 5434 belongs
to another project), so every command set the database variables explicitly. The working tree has
CRLF line endings (Windows `core.autocrlf`), so `pnpm lint` as written (`prettier --check .` with the
repository's `endOfLine: lf`) fails on untouched files; the check above uses `--end-of-line auto`.
The committed blobs are LF.

## Failures
(none)

## Skips
(none)
