# Verification DISC-001-01c

| Field | Value |
|---|---|
| Ticket | DISC-001-01c — Two-Factor Authentication |
| Tier | FEATURE |
| Date | 2026-10-01 |
| Verifier | `ddw-module-verifier` (did not write the code), on commit `157efbb` |
| Module | `apps/api/src/identity`, `apps/api/src/shared`, `packages/shared/src/auth`, `apps/web/src/features/{auth,two-factor}` |
| Line coverage | 96.45% (2256/2339) |
| Branch coverage | 92.89% (1059/1140) |
| Function coverage | 92.85% (559/602) |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Lint | `pnpm lint` (ESLint strictTypeChecked + Prettier --check) — clean; `pnpm typecheck` — clean |

Commands run by the verifier, all exit 0: `pnpm test:coverage` (90 files, 886 passed, 2 skipped by
FIX-002 `runIf`), `pnpm e2e` (44/44), `pnpm test:perf` (4/4), `pnpm lint`, `pnpm typecheck`,
`drizzle-kit check`. Files touched by this ticket alone: 97.49% lines, 93.88% branches, 92.31%
functions.

## Acceptance criteria

Tests assert bodies, database rows, cookies and attempt counts, not only status codes.

- ✅ AC-01 — `two-factor-enrollment.test.ts:360`, `apps/web/test/security-settings-container.test.tsx:53`, e2e `two-factor.spec.ts:124` (`start-two-factor-setup.ts:StartTwoFactorSetup.execute`, `enable-two-factor.ts:EnableTwoFactor.execute`)
- ✅ AC-02 — `two-factor-enrollment.test.ts:393`, e2e `two-factor.spec.ts:124` (enable returns the codes once; `get-two-factor-status.ts` returns only the count)
- ✅ AC-03 — `two-factor-enrollment.test.ts:792, 833`, e2e `two-factor.spec.ts:235` (`disable-two-factor.ts:DisableTwoFactor.execute`)
- ✅ AC-04 — `second-factor-sign-in.test.ts:199, 311`, `apps/web/test/sign-in-container.test.tsx:57`, e2e `two-factor.spec.ts:172` (`sign-in.ts:SignIn.execute`, `verify-second-factor.ts:VerifySecondFactor.execute`)
- ✅ AC-05 — `second-factor-sign-in.test.ts:311, 340`, e2e `two-factor.spec.ts:172` (`verify-second-factor.ts:decide`, `second-factor-limits.ts:recordSignInFailure`)
- ✅ AC-06 — `second-factor-sign-in.test.ts:259`, e2e `two-factor.spec.ts:213` (`complete-google-sign-in.ts`, `google-routes.ts`)
- ✅ AC-07 — `two-factor-enrollment.test.ts:431, 453, 501, 792`, `email-worker.test.ts:316`, e2e `two-factor.spec.ts:124` (version bump, revoke all sessions, caller re-issued, notice email)

NFR-01 — `second-factor-sign-in.test.ts:340`; NFR-02 — `two-factor-enrollment.test.ts:393`;
NFR-03 — `totp.test.ts:21, 29`, `second-factor-sign-in.test.ts:224`; NFR-04 —
`second-factor-sign-in.test.ts:359, 369`, `two-factor-enrollment.test.ts:874`.

## Spec blocks

- ✅ Block 1 — TOTP engine, secret encryption and persistence: every task done, 14/14 required tests (`totp.test.ts`, `secret-box.test.ts`, `recovery-code.test.ts`, `two-factor-persistence.test.ts`, `email-worker.test.ts:249, 284, 316, 371`, `env.test.ts:187`, `migration.test.ts:528`)
- ✅ Block 2 — enrollment, disabling and notices: every task done, 15/15 required tests (`two-factor-enrollment.test.ts:360–1238`) plus fault and race tests
- ✅ Block 3 — second step of sign-in: every task done, 14/14 required tests (`second-factor-sign-in.test.ts:199–661`, `second-factor-races.test.ts:76, 113, 133, 226, 286`, `second-factor.perf.test.ts:39`)
- ✅ Block 4 — web: every task done, 9/9 required tests (5 e2e flows, `security-settings-container.test.tsx`, `second-factor-container.test.tsx`, `two-factor-components.test.tsx`, `two-factor-i18n.test.tsx`); Tests: every new and modified e2e and web test listed in the spec's Block 4 file list exists and passes

Decision-log deviations (lock order, per-user disable limits, re-issued session, `findLive`,
`via` in logs) are implemented as recorded.

## Tests

- ✅ Sad-path tests: `GET /auth/2fa` (401, 403); `POST /auth/2fa/setup` (401, 403, 409, 503); `POST /auth/2fa/enable` (7 malformed codes → 400, wrong/replayed/no-setup, 409, 503, unopenable secret → 500); `POST /auth/2fa/disable` (11 malformed codes → 400, wrong/replayed/used code, 429 at 15 min and 24 h, 409, 503, concurrent disables); `POST /auth/2fa/verify` (9 malformed cases → 400, expired/missing/consumed challenge, more than 5 attempts, reset or disable in between, 429, 503); sign-in and Google callback racing enable; web forms (malformed codes, wrong code, expired challenge, rate limited, unavailable, offline, QR render failure).
- ✅ Lint and type checker clean (F-VER-05).
- ✅ TDD evidence per block in `docs/ddw/reports/tdd-DISC-001-01c.md`; every cited test exists on disk.

## Warnings

- ⚠️ W-VER-02 — per-file branch coverage below 90% on defensive branches: `infrastructure/security/totp.ts` 78.57% (invalid base32 and padding), `start-two-factor-setup.ts` 75%, `domain/errors.ts` 75%, `drizzle-recovery-code-repository.ts` 50%, `second-factor-limits.ts` and `two-factor-routes.ts` 85.71%, `drizzle-sign-in-challenge-repository.ts` 87.5%, `email-worker.ts` 88.67%.
- ⚠️ W-VER-01 — `domain/recovery-code.ts:2` re-exports `RECOVERY_CODE_COUNT` used only by tests; `MAX_CHALLENGE_ATTEMPTS` exported but used only in its file.
- ⚠️ W-VER-03 — e2e TOTP codes follow the wall clock (`apps/web/e2e/support/totp.ts`, can wait up to 30 s within a 120 s timeout); `two-factor-persistence.test.ts:346` relies on a 100 ms sleep; e2e `resetAttemptLimits` empties `auth_attempts`, safe only with `workers: 1`.
- ⚠️ TDD evidence line numbers shifted in later review rounds (every test matched by name); Block 4 component suites were red as missing modules, as the evidence file states.
- ⚠️ `.env.example` lacks `TOTP_ENCRYPTION_KEY`; the user adds it (the file is off-limits to the agents).

Result: PASSED
