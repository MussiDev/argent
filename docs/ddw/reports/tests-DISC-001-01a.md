# Test run DISC-001-01a

| Field | Value |
|---|---|
| Runner | vitest 5.0.1 (V8 coverage via @vitest/coverage-v8 5.0.1) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_test pnpm test:coverage` |
| Total | 491 |
| Passed | 491 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 95.27% |
| Branch coverage | 92.30% |
| Function coverage | 92.74% |
| Coverage floor | 80% lines, branches and functions (AGENTS.md, "Testing") |
| Lint | `pnpm lint` (next typegen + ESLint strictTypeChecked + Prettier --check) — clean, 0 findings; `pnpm typecheck` — clean |

## Scope

Coverage is measured over `apps/api/src`, `apps/web/src` and `packages/shared/src` together, as
AGENTS.md requires. Only `**/*.d.ts` and `**/*.css` are excluded (no executable logic). Per
workspace: API 93.58% lines / 90.27% branches / 90.51% functions; shared 100% / 100% / 100%;
web 99.20% / 96.74% / 97.44%.

Other suites run in the same closeout: `pnpm test:perf` (latency benchmarks, 2/2 passed, separate
CI job) and `pnpm e2e` (Playwright, 25/25 passed with
`E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_e2e` and Mailpit).

## Failures
(none)

## Skips
(none)
