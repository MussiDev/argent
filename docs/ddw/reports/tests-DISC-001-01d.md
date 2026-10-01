# Test run DISC-001-01d

| Field | Value |
|---|---|
| Runner | Vitest 5.0.1 (V8 coverage) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_01d_test pnpm test:coverage` |
| Total | 1059 |
| Passed | 1059 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.68% |
| Branch coverage | 92.72% |
| Function coverage | 93.47% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

The run used the database `argent_01d_test` created for this worktree (Postgres of this project on
port 5435), because another worktree runs tests in parallel; no other database was touched. The
suite has 103 test files across the three Vitest projects (api, shared, web).

Other runs of this ticket:
- Latency benchmark `pnpm exec vitest run --config vitest.perf.config.ts test/perf/profile-latency.perf.test.ts`
  (apps/api): 1 of 1 passed; 500 `PATCH /profile` requests over 8 connections, all answered 200, p95
  100.96 ms against the limit of 300 ms (NFR-01).
- Playwright `pnpm exec playwright test apps/web/e2e/profile.spec.ts` on `argent_01d_e2e`: 3 of 3
  passed (edit and save across sign-out and sign-in, an empty name refused, language switch to
  English and back), and `auth.spec.ts` plus `two-factor.spec.ts`: 27 of 27 passed as regression.
- `pnpm audit --prod --audit-level high` — no known vulnerabilities.

TDD evidence per block (failing before the implementation, with the assertion that broke):
- Block 1: `account-defaults.test.ts` "uses the shared display currency and language lists (FR-05)"
  failed with `expected [ 'ARS', 'USD' ] to be undefined`; the three new shared test files could not
  load their modules before implementation.
- Block 2: with a stub adapter, 9 of 10 `profile-persistence.test.ts` tests failed, for example
  `expected null to deeply equal { …(7) }` and `expected '42703' to be '23514'`; 12 of 16
  `migration.test.ts` tests failed (`expected 6 to be 7`, missing 0007 rollback file).
- Block 3: 28 of 29 profile API tests failed before the implementation, for example `expected 404 to
  be 200`, `Error: not implemented`, and the benchmark `expected { '404': 500 } to deeply equal {
  '200': 500 }`; the one that passed (403 without the web origin) is a regression guard of the
  global origin guard.
- Block 4: with module stubs, 68 of 137 tests in 8 web test files failed, for example `expected {} to
  deeply equal { fields: { displayName: 'displayNameRequired' } }` and `Unable to find an accessible
  element with the role "link" and name "Profile"`. The correction round added a race test that
  failed on the old container (`expected [ [Function], [Function], [Function] ] to have a length of 2
  but got 3`) and passes after the fix.

Environment note: the migration test uses a database named `argent_migration_test` on the same
server, shared by name with other worktrees; no interference was seen in this run.

## Failures
(none)

## Skips
(none)
