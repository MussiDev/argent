# Test run DISC-001-01e

| Field | Value |
|---|---|
| Runner | Vitest 5.0.1 (V8 coverage) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argent_01e_test pnpm test:coverage` |
| Total | 1460 |
| Passed | 1460 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.76% |
| Branch coverage | 92.30% |
| Function coverage | 94.16% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

The run used the database `argent_01e_test` created for this worktree (Postgres of this project on
port 5435), because other worktrees run tests in parallel; no other database was touched. The suite
has 113 test files across the three Vitest projects (api, shared, web). It was run on the branch
rebased onto main after the merge of DISC-001-02a (PR #13) and of the Pesly rename (PR #12).

Other runs of this ticket:
- Latency benchmarks `pnpm exec vitest run --config vitest.perf.config.ts test/perf/auth-latency.perf.test.ts test/perf/google-callback.perf.test.ts test/perf/second-factor.perf.test.ts` (apps/api): 4 of 4 passed in the block run; the registration benchmark sends the new `displayName`, answers 202 for all 500 requests and keeps p95 below 500 ms (NFR-01).
- Playwright `pnpm exec playwright test` on `argent_01e_e2e` (ports 3000, 4000 and 4100 were free): 59 of 59 passed, including the three new tests of this ticket (a registered name shown on the profile, the required message without a name, a Google sign-up name shown on the profile) and the accounts specs of DISC-001-02a.
- `pnpm audit --prod --audit-level high` — no known vulnerabilities.

TDD evidence per block (failing before the implementation, with the assertion that broke):
- Block 1: 10 failures against a stub: `expected true to be false` (NUL, missing, empty names accepted), `expected undefined to be 'Ana'` (the schema stripped the unknown key), `expected '  Ana Pérez  ' to be 'Ana Pérez'` and `expected '' to be null` for `displayNameFromGoogleClaim`.
- Block 2: 5 failures: `display_name` expected `Ana Pérez`, got null (registration, repository, existing-email test and `GET /profile`), and `created[0]?.displayName` expected `Ana Pérez`, got undefined; nine guard cases passed before by design (Block 1's schema already rejected invalid names).
- Block 3: 23 failures: `expected 'Typed Name' to be 'Ana Google'` (supersede), `expected null to be 'Ana Gómez'` (Google sign-up), scope `openid email` instead of `openid email profile`, `expected the failure URL, received https://links.argent.test/en`; AC-06 and AC-08 passed before as guards.
- Block 4: 21 failures with a stub: `expected 'required' to be 'tooLong'`, `expected { form: 'validationFailed' } to deeply equal { fields: { displayName: … } }`, 8 of 9 register-container tests (no field yet), the accessibility check and the catalog-keys test.
- Corrective round after merging main (DISC-001-02a): its Playwright accounts specs registered users without the now required display name, so 9 of them failed (`expect(getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible()` failed, the form stayed on the registration screen); filling the display name in the `signedInUser` helper of `apps/web/e2e/accounts.spec.ts` made the whole run pass (59 of 59).

Environment note: the first full run of Block 2 overlapped with a benchmark on the same database and deadlocked on the table truncation; a sequential rerun was green. Runs against one database are kept sequential.

## Failures
(none)

## Skips
(none)
