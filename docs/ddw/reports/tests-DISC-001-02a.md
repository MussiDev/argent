# Test run DISC-001-02a

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent02a_test pnpm test:coverage` |
| Total | 1175 |
| Passed | 1175 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.59% |
| Branch coverage | 92.38% |
| Function coverage | 93.75% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

## Scope

Coverage is measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as
AGENTS.md requires: 99 test files, 1175 tests. Every suite below ran on the tree of commit
`0bdae34` (all eight blocks of the spec):

- `pnpm e2e` (Playwright): 50/50 passed, the 6 new accounts flows plus the earlier identity flows,
  with `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent02a_e2e` and the shared
  Mailpit.
- `pnpm test:perf`: 5/5 passed in 4 files, including the accounts list benchmark (100 accounts,
  100,000 test-only movement rows, p95 about 35 ms against the 300 ms limit of NFR-02).

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
