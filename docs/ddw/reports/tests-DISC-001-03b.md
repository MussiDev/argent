# Test run DISC-001-03b

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent03b_test pnpm test:coverage` |
| Total | 3325 |
| Passed | 3325 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 97.27% |
| Branch coverage | 92.78% |
| Function coverage | 95.04% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto` on every file changed by the branch — clean; `pnpm typecheck` — clean |

## Scope

Closeout run of the ticket on the tree rebased onto `origin/main` after DISC-001-07a (PR #19, migration 0013), with migration 0014 generated afterwards. Measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as AGENTS.md requires: 200 test files, 3325 tests, 922 s. Every block's tests were run on their own as the blocks were built; the TDD evidence (what was seen failing before each implementation, and where a test could not go red) is in `docs/ddw/reports/tdd-DISC-001-03b.md`.

Other suites run on the same tree:

- `pnpm e2e` (Playwright): 76/76 passed, 3.2 min, with `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent03b_e2e` and the shared Mailpit; ports 3000, 4000 and 4100 were free; the five movement flows are in `apps/web/e2e/movements.spec.ts`;
- `pnpm test:perf`: 7 files, 8 tests passed; accounts list with 100 accounts and 100,000 movements p95 37.5 ms (NFR-06) and saving a movement p95 80.2 ms (NFR-03), both against a 300 ms threshold;
- `pnpm audit --prod --audit-level high`: no known vulnerabilities.

## Failures

(none)

## Skips

(none)
