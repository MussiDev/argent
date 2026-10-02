# Test run DISC-001-01f

| Field | Value |
|---|---|
| Runner | Vitest 5.0.1 (unit and integration, V8 coverage), Playwright (end-to-end) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_01f_test pnpm test:coverage` |
| Total | 1659 |
| Passed | 1659 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.78% |
| Branch coverage | 92.44% |
| Function coverage | 94.07% |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` clean, 0 findings; `prettier --check --end-of-line auto .` clean; `pnpm typecheck` clean |

## Failures
(none)

## Skips
(none)

## Notes

- Vitest ran on its own database `argent_01f_test` (port 5435); no other database was touched. 124 files, 1659 tests, over `apps/api/src`, `apps/web/src` and `packages/shared/src` together.
- Playwright: `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_01f_e2e pnpm exec playwright test` from the repo root, 62 of 62 passed, including the 3 new tests of `apps/web/e2e/delete-user.spec.ts`. Ports 3000, 4000 and 4100 were free before and after the run.
- `pnpm audit --prod --audit-level high`: no known vulnerabilities.
- `pnpm lint` as written (`prettier --check .` without `--end-of-line auto`) reports only CRLF line endings on this Windows checkout, in 388 files including untouched ones; with `--end-of-line auto` it is clean.
