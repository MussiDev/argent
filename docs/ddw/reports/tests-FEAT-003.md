# Test run FEAT-003

| Field | Value |
|---|---|
| Runner | Vitest 5.0.1 (V8 coverage) |
| Command | `TEST_DATABASE_URL=postgres://argent:argent@localhost:5435/argentfeat003_test pnpm test:coverage` |
| Total | 1616 |
| Passed | 1616 |
| Failed | 0 |
| Skipped | 0 |
| Line coverage | 96.92% |
| Branch coverage | 92.51% |
| Function coverage | 94.44% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean, 0 findings; `pnpm exec prettier --check --end-of-line auto .` — clean |

## Failures
(none)

## Skips
(none)

Other checks on the same tree (`feat/FEAT-003-available-balance`, 8 blocks committed):
- `pnpm typecheck` — clean for `packages/shared`, `apps/api` and `apps/web`.
- `pnpm test:perf` — 5 files, 6 tests passed; the accounts list performance test measured p95 30.3 ms against the 300 ms budget (NFR-02) with the three totals and 100,000 movements.
- `pnpm e2e` with `E2E_DATABASE_URL=postgres://argent:argent@localhost:5435/argentfeat003_e2e` (ports 3000, 4000 and 4100 checked free first) — 62 passed, including the accounts spec (12 tests, three new for FEAT-003).
- `pnpm audit --prod --audit-level high` — no known vulnerabilities (no dependency was added).
- `pnpm lint` as written (`prettier --check` without `--end-of-line auto`) reports 409 files for CRLF line endings on this Windows checkout, also on files this ticket did not touch; the check with `--end-of-line auto` is clean.

Migration 0011: journal `when` 1790943616052, written by drizzle-kit at generation time, above main's maximum 1790895423195 (migration 0006). The rollback script deletes the journal row with the same `created_at`.

TDD evidence by block (each block was run against a compiling skeleton so the new tests failed on their own assertions, not on an import error):
- Block 1: 24 tests failed before the implementation (`defaultIncludeInAvailable is not a function`; no issue at `includeInAvailable` for a non-boolean and for a credit card set to true; the rename schema did not reject the field; response schemas parsed without `includeInAvailable`; `expected 500 to be 409` for `ACCOUNT_ARCHIVED`).
- Block 2: 23 of 27 migration tests failed before (missing 0011 rollback file, `expected 8 to be 9`); the backfill, NOT NULL, CHECK, forced-failure and rollback tests carry real assertions (a legacy savings row expected false and got undefined).
- Block 3: on a skeleton, 16 failed on their own assertions (`expected { cash: false, … } to deeply equal { cash: true, … }`, `Error: todo`, totals `{ ARS: 0n } vs { ARS: 1450n }`, `creditCardCount` `+0 to be 2`); AC-05, `netWorthTotals` and the failing-port test passed as regression guards, and two vacuous tests (AC-15, AC-20) were strengthened.
- Block 4: 8 new repository tests failed on a skeleton (`expected undefined to be false`, `expected {status:'not_found'} to deeply equal {status:'credit_card'}`, a row-lock race test that settled immediately); one vacuous not-found test got a positive control.
- Block 5: 15 failed on a skeleton (`expected 404 to be 200`, `expected 404 to be 409`, `expected true to be false`, availableTotals `3050 vs 2000`, audit list length); the PUT origin test, the PATCH rejection and the no-card list were added after review and verified non-vacuous by mutation.
- Block 6: 18 failed on a skeleton (`messageKey unexpected vs accountArchived`, `INTERNAL vs ok`, catalog `undefined vs 'Disponible'`); the unsafe-id test is a regression guard of the existing path guard.
- Block 7: 42 new or adapted tests failed on a skeleton (`Unable to find an accessible element with the role "checkbox"`, `role "region" and name "Deudas"`, create payload deep-equal mismatch); after review, `expected true to be false` (checkbox still `disabled` while pending) and `expected <h3> to be null` (Debt section shown without `creditCardCount`).
- Block 8: the product code already existed, so the perf, overflow and e2e tests passed on first run; non-vacuity was shown by mutation (cards counted into Available made the overflow and perf tests fail: `ARS expected "4000000000000000000", received "6300000000000000000"`; a 0.1 ms bound failed `expected 30.2864 to be less than 0.1`; mutating the totals made all three 9,300-account tests fail).
