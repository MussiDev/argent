# Verification DISC-001-01f

| Field | Value |
|---|---|
| Module | `apps/api/src/identity/**`, `packages/shared/src/profile/delete-user.ts`, `apps/web/src/features/profile/**`, migration `0010_account_deletion` |
| Line coverage | 96.81% |
| Branch coverage | 92.47% |
| Function coverage | 94.19% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` clean, `pnpm typecheck` clean, `prettier --check --end-of-line auto .` clean |

Verified by an independent `ddw-module-verifier` (two rounds). Round 1 was BLOCKED on decision O-2 (the web screen had no "set a password first" hint); the corrective round added it in commit `c02ec10`, the tests and SAST receipts were re-earned (1668 of 1668 Vitest, 62 of 62 Playwright), and round 2 passed.

## Acceptance criteria
- ✅ AC-01 — `delete-user.test.ts` "deletes the account with the right password: 204, the cookies cleared and the old tokens dead"; `user-erasure.test.ts` "has 0 rows for the user in every registered table and its outbox" (`apps/api/src/identity/infrastructure/db/drizzle-user-deletion-repository.ts`, `erase`)
- ✅ AC-02 — `delete-user.test.ts` "answers 401 INVALID_CREDENTIALS for a wrong password, keeps the account and counts one failure" and "answers 429 to the 6th delete attempt and to a password sign-in after 5 wrong passwords, without hashing" (`apps/api/src/identity/application/delete-user.ts`, `checkPassword`)
- ✅ AC-03 — `delete-user.test.ts` "deletes with the right password and a valid TOTP code" and "deletes with the right password and an unused recovery code, typed as the user sees it" (`delete-user.ts`, `checkSecondFactor`)
- ✅ AC-04 — `delete-user.test.ts` "refuses without a code, with a wrong code, a replayed TOTP code and a used recovery code: 400 and the account stays"
- ✅ AC-05 — `delete-user.test.ts` "answers 429 to the 6th wrong code within 15 minutes without checking the code" and the 21st-within-24-hours case
- ✅ AC-06 — `deletion-reauth.test.ts` "answers 200 with a fresh-login authorization URL, sets the binding cookie and stores a delete_account state" and "issues a grant, sets its cookie and redirects to ?reauth=ready" (`start-deletion-reauth.ts`, `complete-deletion-reauth.ts`)
- ✅ AC-07 — `deletion-reauth.test.ts` "redirects with the refusal flag when the user cancels or Google reports a problem", "refuses an auth_time older than the state and one in the future", `deletion-reauth-dispatch.test.ts` "never resolves, links or creates an account" (`complete-google-sign-in.ts`, dispatch by purpose)
- ✅ AC-08 — `delete-user-use-case.test.ts` "deletes the account, consumes the grant and clears the session and grant cookies" and "needs the second factor too: a wrong or missing code gets 400, keeps the account and the grant" (`delete-user.ts`, `checkGrant`)
- ✅ AC-09 — separate tests for an expired grant, another user's grant, another session family's grant and a missing or unknown token (all 401 REAUTHENTICATION_REQUIRED); "deletes once when two requests race with one grant"
- ✅ AC-10 — `delete-user.test.ts` "does not delete the account with a live grant cookie and no password"; `deletion-reauth.test.ts` "answers 400 VALIDATION_FAILED for a user with a password"; web `delete-user-container.test.tsx` "never shows the Google step to a user with a password"

## Spec blocks
- ✅ Block 1 — contracts, `REAUTHENTICATION_REQUIRED`, log redaction (`f043162`); every task done, tests named above and in `delete-user.test.ts` (shared), `error-handler.test.ts`, `logger.test.ts`
- ✅ Block 2 — migration 0010, grant and OAuth state storage, user erasure (`c134f2c`); `deletion-persistence.test.ts` and `migration.test.ts` (lock timeout, journal order, rollback and re-apply)
- ✅ Block 3 — `DeleteUser` and `POST /profile/delete`, erasure guard (`7a74a25`); `delete-user.test.ts`, `delete-user-races.test.ts`, `user-erasure.test.ts` (unregistered table, non-cascading key, fixture tables ignored by exact name)
- ✅ Block 4 — Google re-authentication and the deletion grant (`3bd0e48`); `deletion-reauth.test.ts`, `deletion-reauth-dispatch.test.ts`
- ✅ Block 5 — web delete-account screen (`7f20ccc`) and the O-2 hint (`c02ec10`); `delete-user-container.test.tsx`, `delete-user-components.test.tsx`, `delete-user-i18n.test.tsx`, `e2e/delete-user.spec.ts` (3 tests)

## Tests
- Tests: the named tests above, run in the suite of 1668 of 1668 and the 62 Playwright specs.
- ✅ Sad-path tests: every input has one — password missing, wrong, oversized, rate limited; second factor missing, wrong, replayed, malformed, over both windows; grant missing, unknown, expired, another user, another session family, consumed; Google flow wrong or missing binding, used or expired state, other identity, `auth_time` out of window, revoked family, Google error, failed exchange; start without a session (401), rate limited (429), password account (400)
- ✅ Decision O-2: the API answers 401 REAUTHENTICATION_REQUIRED (`delete-user.test.ts`, "no password and no linked Google identity"); the web screen asks to set a password through forgot-password (`delete-user-container.test.tsx`, `delete-user-i18n.test.tsx`)

## Findings (not failing)
- Spec drift: spec line 336 lists "a wrong binding cookie" under `?reauth=failed`, while A-11, the callback contract and Error handling say it redirects as a failed sign-in; the code and its test follow A-11. The spec is frozen, so the wording fix is left for CLOSEOUT.
- O-2 hint strength: `deletionReauth` stays `'password'|'google'`, so the web cannot tell the O-2 account from a Google one; the hint is a short note under the Google step for every Google-path user and a prominent alert after `?reauth=failed` or REAUTHENTICATION_REQUIRED. A targeted message needs a third `deletionReauth` value, a contract change for a later ticket.
- TDD evidence: Block 4 had 57 of 183 tests failing before implementation, Block 5 had 60 of 60 Vitest tests failing; Playwright specs were written after the code; the corrective round had 8 of 8 new tests failing on missing keys, assertion text not captured.
- R-09 stays open until the manual post-deploy check with a real Google account.
- Merge notes: 02b and 07a must register their tables in the erasure guard; the migration `when` is bumped and 0010 regenerated if 0008 or 0009 land first.

Result: PASSED

## Post-closeout update (2026-10-02)

PR #16 became conflicting when #15 (DISC-001-02b, migration 0009 with `when` 1790902441319) merged into main. The branch was rebased onto main: journal idx 9 is 0009 and idx 10 is 0010 (`when` 1790943164350, above main's maximum), the 0010 snapshot was re-chained onto 0009's snapshot (`drizzle-kit generate` reports no changes), the migration tests chain 0010, 0009, 0007 and down, and the erasure guard registers `categories` and `category_defaults_seeded` (policy `cascade`; the self-referencing key of the category tree is the one non-cascading key it accepts). Re-run on the rebased branch: Vitest 2041 of 2041 (132 files), coverage 96.93% lines, 95.64% statements, 92.17% branches, 94.76% functions; Playwright 67 of 67; ESLint, typecheck and prettier clean. No behaviour of the ticket changed.
