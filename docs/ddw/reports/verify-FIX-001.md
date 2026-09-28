# Verification FIX-001

| Field | Value |
|---|---|
| Module | `apps/api/src/identity/application/refresh-session.ts`, `apps/api/src/identity/application/sign-in.ts` |
| Implementation | commit 8d18035 |
| Cross-check | `ddw-module-verifier` (did not write the code) |
| Line coverage | 95.28% |
| Branch coverage | 92.32% |
| Function coverage | 92.74% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean; `pnpm typecheck` — clean; Prettier clean on changed files (CRLF-only noise from `core.autocrlf` in the worktree) |

## Acceptance criteria
- ✅ AC-01 — `treats a claim lost to a concurrent rotation as reuse (401)…` (`apps/api/test/identity/refresh-session.test.ts:152`) and the unchanged real-database test `with two concurrent refreshes of one token…` (`apps/api/test/identity/sessions.test.ts:209`); code `refresh-session.ts:86-87`
- ✅ AC-02 — `rejects (401) a claim lost to a sign-out without revoking the family` (`refresh-session.test.ts:164`) and `rejects (401) a refresh whose claim loses to a sign-out, without treating it as reuse` (`apps/api/test/identity/reset-session-races.test.ts:207`); code `refresh-session.ts:88`
- ✅ AC-03 — `rejects (401) a lost claim whose session row is missing on re-read` (`refresh-session.test.ts:174`); code `refresh-session.ts:86-88`
- ✅ AC-04 — `answers 429 RateLimited and reports the failure when the refund of a refused attempt fails` (`apps/api/test/identity/sign-in-use-case.test.ts:183`); code `sign-in.ts:95-99`
- ✅ AC-05 — `answers 429 RateLimited without reporting anything when the refund of a refused attempt succeeds` (`sign-in-use-case.test.ts:198`); code `sign-in.ts:95-100`

## Spec blocks
- ✅ Block 1 — fix-plan steps 1–8 all implemented (`refresh-session.ts:19-24,82-88`, `ports/session-repository.ts:29-34`, `sign-in.ts:47-51,92-101`, the three test files)

## Tests
- ✅ Regression tests: red before the fix on the expected assertion — the sign-out, missing-row and re-read tests and the sign-out race integration test answered `reused`, and the refused-refund sign-in test rejected with the database exception instead of `RateLimited`; green after the fix. The rotation-reuse and refund-success tests were green before and after (behaviour unchanged).
- ✅ Sad-path tests: `propagates a re-read error after a lost claim and revokes nothing` (`refresh-session.test.ts:184`) and the refused-refund sign-in test (`sign-in-use-case.test.ts:183`) cover the documented sad paths.
- ✅ Full suite: 497/497 (`docs/ddw/reports/tests-FIX-001.md`).

## Warnings
- ⚠️ W-VER-03-adjacent: the sign-out race integration test calls the use case directly, so "no reuse warning is logged" is implied by the `rejected` outcome rather than asserted on the route log.
- ⚠️ AC-02 "other sessions of the family unrevoked" is proven through the fake's `revokedFamilies = []`; no test puts a second live session in the family (a family holds one live session at a time, per the RCA).
- ⚠️ AC-04 is verified at the use-case level; the HTTP 429 mapping relies on the existing middleware tests.

Result: PASSED
