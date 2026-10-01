# Verification FIX-004

| Field | Value |
|---|---|
| Module | `apps/api/src/identity/application/complete-google-sign-in.ts` |
| Fix-plan | docs/ddw/specs/fix-FIX-004.md |
| RCA | docs/ddw/specs/rca-FIX-004.md |
| Implementation commit | `496284d` |
| Line coverage | 95.75% |
| Branch coverage | 92.41% |
| Function coverage | 92.41% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean; `pnpm typecheck` — clean; Prettier clean on both changed files |
| Cross-verification | `ddw-module-verifier` (an agent that did not write the code): PASSED, 1 warning; re-ran the Google tests 34/34, the race test 10/10 and the full suite 699/699 |

## Acceptance criteria
- ✅ AC-01 — a callback whose competitor commits between the identity and the email lookups signs in with `via: existing_identity` to the competitor's user (`apps/api/test/identity/google-sign-in-races.test.ts:234`); code `complete-google-sign-in.ts:161-166`
- ✅ AC-02 — four concurrent callbacks end with one user and one identity, and every redirect goes to the signed-in page (`google-sign-in-races.test.ts:159`; 20/20 local runs, 10/10 re-run by the verifier)
- ✅ AC-03 — a user found by email whose Google identity has a different subject is refused with `another_identity_linked`, and nothing is created (`google-sign-in-races.test.ts:255`); code `complete-google-sign-in.ts:164, 167`

## Spec blocks
- ✅ Block 1 — fix-plan steps 1–3 implemented in `496284d`; step 4 (`CHANGELOG.md`) is deferred to CLOSEOUT by the fix-plan itself

## Tests
- ✅ Regression test: `signs in to the account a concurrent callback created between the identity and the email lookups` — failed before the fix with "expected { outcome: 'failed', …(2) } to match object { outcome: 'signed_in', …(1) }" (reason `another_identity_linked`), passes after
- ✅ Every test the fix-plan listed exists and passes (5 of 5); full suite 699 passed, 0 skipped (docs/ddw/reports/tests-FIX-004.md)
- ✅ Sad-path tests: `identity error: still refuses a user whose Google identity has a different subject, creating nothing` (`:255`), `fails after a second conflict instead of retrying again (sad path)` (`:275`), `lets an unexpected database fault through instead of turning it into a failure redirect` (`:290`)
- ✅ Dead code: none (W-VER-01)

## Warnings (non-blocking)
- ⚠️ The existing R-37 test (`google-sign-in-races.test.ts:297`) uses a non-authoritative email, so it stops before the new branch; threat R-02's "the existing R-37 test still runs" holds but does not exercise the new code. Low risk: the new branch runs only for authoritative emails, whose identities a password reset does not delete, and the re-read returns the user together with its link in one statement.
- ⚠️ W-VER-03 — the first full run on this machine timed out once in `architecture-boundaries.test.ts` (ESLint cold start right after Docker Desktop started); unrelated to the change.

Result: PASSED
