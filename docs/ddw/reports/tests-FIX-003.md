# Test run FIX-003

| Field | Value |
|---|---|
| Runner | Vitest 5.0.1 (Node 24.13.1, win32-x64) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_test pnpm test:coverage` |
| Total | 673 |
| Passed | 671 |
| Failed | 0 |
| Skipped | 2 |
| Line coverage | 95.74% |
| Branch coverage | 92.39% |
| Function coverage | 92.41% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm typecheck` — clean; `pnpm audit --prod --audit-level high` — no known vulnerabilities; Prettier clean on every changed file (the local Windows checkout converts to CRLF, which `prettier --check` reports; with `--end-of-line auto` the changed files pass) |

## New tests (FIX-003)

- `apps/api/test/foundation/worker-env.test.ts` — 7 tests: production with only the worker's seven
  settings and no `JWT_SECRET` or Google settings (regression, AC-01, AC-02), invalid
  `WEB_BASE_URL` error (AC-03), invalid `EMAIL_PROVIDER` error (AC-04), missing `DATABASE_URL`
  error with no value printed (AC-05), missing Resend settings error, resend refused outside
  production, local sender default.
- `apps/api/test/foundation/env.test.ts` — unchanged and green: the API schema keeps every rule,
  Google production checks included (AC-06).

RED evidence: before the implementation all 7 tests in `worker-env.test.ts` failed with
`TypeError: parseWorkerEnv is not a function`.

End-to-end: `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_e2e pnpm e2e` —
39 passed. The e2e email worker now starts with `WORKER_ENV` only (`DATABASE_URL`,
`WEB_BASE_URL`, `EMAIL_PROVIDER`), and the verification and reset flows that depend on its emails
pass.

Note on this run: two earlier full-suite runs failed with duplicate-key, foreign-key, deadlock and
hook-timeout errors in files this change does not touch, while `pg_stat_activity` showed another
session's suite connected to the same `argent_test` database. The failing files passed in
isolation with and without this change; the full suite above ran once that session had released
the database.

## Failures
(none)

## Skips
- `Railway config for api > starts Next.js with node directly, with no pnpm parent process` — reason: web-only assertion, `it.runIf(name === 'web')`
- `Railway config for worker > starts Next.js with node directly, with no pnpm parent process` — reason: web-only assertion, `it.runIf(name === 'web')`
