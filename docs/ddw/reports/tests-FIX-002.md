# Test run FIX-002

| Field | Value |
|---|---|
| Runner | Vitest 5.0.1 (Node 24.13.1, win32-x64) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_test pnpm test:coverage` |
| Total | 517 |
| Passed | 517 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 95.28% |
| Branch coverage | 92.32% |
| Function coverage | 92.74% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm typecheck` — clean; `pnpm audit --prod --audit-level high` — no known vulnerabilities; Prettier clean on every changed file (the local Windows checkout converts to CRLF, which `prettier --check .` reports on every file; CI checks out LF) |

## New tests (FIX-002)

- `apps/api/test/deploy/build-output.test.ts` — 7 tests: entry points import no `.ts`/`tsx`
  (regression, AC-02), module graphs load with plain node, no inlined environment value (R-01),
  migrations applied to an empty database (AC-03), missing `DATABASE_URL` error (AC-04), migration
  error, build error.
- `apps/api/test/deploy/railway-config.test.ts` — 12 tests (4 per service): pnpm build and start
  (AC-01), heap cap and restart policy (AC-07), no variables (R-01), pre-deploy migration only on
  the API (AC-05).
- `apps/web/test/start-script.test.ts` — 1 test: no port flag (AC-06).

RED before the fix (same command scoped to these files): all three files failed — the build script
did not exist, `apps/api/railway.json` did not exist (`ENOENT`), and the web start was
`next start --port 3000`.

## Failures
(none)

## Skips
(none)
