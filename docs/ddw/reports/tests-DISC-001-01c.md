# Test run DISC-001-01c

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_test pnpm test:coverage` |
| Total | 888 |
| Passed | 886 |
| Failed | 0 |
| Skipped | 2 |
| Line coverage | 96.45% |
| Branch coverage | 92.89% |
| Function coverage | 92.85% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm lint` (next typegen + ESLint strictTypeChecked + Prettier --check) — clean, 0 findings; `pnpm typecheck` — clean |

## Scope

Coverage is measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as
AGENTS.md requires. The run is on the tree of commit `5d060bf` (all four blocks). Other suites on the
same tree: `pnpm e2e` (Playwright, 44/44 passed — 39 from DISC-001-01a/01b and 5 two-factor flows,
with `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_e2e`, Mailpit and the fake
OIDC server) and `pnpm test:perf` (4/4 passed after Block 3, the last block touching the API;
second-factor verify with a recovery code p95 75 ms against 1000 ms). No test calls Google or any
other real external service.

## Failures
(none)

## Skips
- `apps/api/test/deploy/railway-config.test.ts` [api] starts Next.js with node directly — reason: `it.runIf(name === 'web')` runs this check only for the web service (FIX-002 design)
- `apps/api/test/deploy/railway-config.test.ts` [worker] starts Next.js with node directly — reason: `it.runIf(name === 'web')` runs this check only for the web service (FIX-002 design)
