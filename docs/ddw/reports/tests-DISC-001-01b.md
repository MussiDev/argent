# Test run DISC-001-01b

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_test pnpm test:coverage` |
| Total | 639 |
| Passed | 639 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 95.65% |
| Branch coverage | 92.23% |
| Function coverage | 92.29% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm lint` (next typegen + ESLint strictTypeChecked + Prettier --check) — clean, 0 findings; `pnpm typecheck` — clean |

## Scope

Coverage is measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as
AGENTS.md requires. The run is on commit `b3694cc` (all four blocks), executed by the Block 4 block
verifier. Other suites on the same tree: `pnpm e2e` (Playwright, 39/39 passed — 25 from
DISC-001-01a and 14 Google flows against the local fake OIDC server on `127.0.0.1`, with
`E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_e2e` and Mailpit) and
`pnpm test:perf` (3/3 passed; Google callback p95 191 ms against the 500 ms limit, run after
Block 3, which is the last block touching the API). No test calls Google or any other real
external service.

## Failures
(none)

## Skips
(none)
