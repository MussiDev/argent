# Test run DISC-001-01b

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_test pnpm test:coverage` |
| Total | 643 |
| Passed | 643 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 95.65% |
| Branch coverage | 92.24% |
| Function coverage | 92.29% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm lint` (next typegen + ESLint strictTypeChecked + Prettier --check) — clean, 0 findings; `pnpm typecheck` — clean |

## Scope

Coverage is measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as
AGENTS.md requires. Every suite below ran on the tree of commit `09b800a` (all four blocks plus
the SAST M-1 fix): `pnpm e2e` (Playwright, 39/39 passed — 25 from DISC-001-01a and 14 Google flows
against the local fake OIDC server on `127.0.0.1`, with
`E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_e2e` and Mailpit) and
`pnpm test:perf` (3/3 passed, including the Google callback p95 < 500 ms assertion). No test calls
Google or any other real external service.

## Failures
(none)

## Skips
(none)
