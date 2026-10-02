# Verification DISC-001-01e

| Field | Value |
|---|---|
| Ticket | DISC-001-01e — Display Name at Sign-Up |
| Tier | FEATURE |
| Date | 2026-10-01 |
| Verifier | `ddw-module-verifier` (did not write the code), on the branch rebased onto main (commits `3739296`, `f2d291f`, `82b7368`, `72da25b`, `036a1e9`) |
| Module | `apps/api/src/identity` (registration, Google account creation, `display-name.ts`, user repository), `packages/shared/src/{auth/register,profile/profile}.ts`, `apps/web/src/features/auth`, `apps/web/src/lib/display-name-error.ts` |
| Line coverage | 99.05% (419/423) over the files this ticket changed; 96.69% repo-wide |
| Branch coverage | 94.82% (238/251) over the files this ticket changed; 92.82% repo-wide |
| Function coverage | 96.00% (72/75) over the files this ticket changed; 93.50% repo-wide |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

Tests: 1127 passed, 0 failed, 0 skipped in the full run after the rebase onto main
(`pnpm exec vitest run` on `argent_01e_test`), plus 50 of 50 Playwright tests on `argent_01e_e2e`
and 4 of 4 latency benchmarks. The verifier re-ran the six API test files for this ticket (127 of
127) and the shared and web projects (380 of 380); it did not re-run Playwright because its ports
are shared with other worktrees. The coverage summary comes from the closeout run; the rebase
changed no source of this ticket (blob hashes of every changed file are identical before and after).

Approved items, not failures: no migration (the column comes from DISC-001-01d); the signature
`toValidationErrors(error, submitted = {}, codeError)`, where three callers pass `{}`; test-only
options in the fake OIDC server; human decisions O-1 (the `profile` scope; the consent-screen change
was made outside the code by the orchestrator at the human's request), O-2 (a supersede replaces the
display name) and O-3 (R-05 accepted by the owner).

## Acceptance criteria

Tests assert database rows, response bodies and rendered values, not only status codes.

- ✅ AC-01 — `registration.test.ts` "stores the display name trimmed of surrounding spaces and counts code points (AC-01)", `auth-schemas.test.ts` "accepts 1 and 50 characters and trims the value", `register-container.test.tsx` exact request body (`register-user.ts`, `drizzle-user-repository.ts:21`)
- ✅ AC-02 — `registration.test.ts` it.each "rejects a %s display name with 400, no account and no email (AC-02)" (missing, empty, whitespace, 51 characters, NUL, non-string), `profile-schemas.test.ts` NUL case, `register-container.test.tsx` 51-character case, the display name kind tests
- ✅ AC-03 — `registration.test.ts` "shows the registered display name in GET /profile after signing in (AC-03)", e2e `profile.spec.ts` registered name on the profile screen
- ✅ AC-04 — `register-container.test.tsx` "shows the display name field, required, before the email field (AC-04)" and the empty and whitespace cases (no request, focus, `aria-invalid`), `auth-form-accessibility.test.tsx`, e2e `auth.spec.ts` registration without a name
- ✅ AC-05 — `google-sign-in.test.ts` "creates the account with the Google name as display name, shown by GET /profile (AC-05)", `display-name.test.ts`, `google-oidc-identity-provider.test.ts` name mapping and scope, e2e `google.spec.ts` (`google-oidc-identity-provider.ts:41`, `complete-google-sign-in.ts:246`)
- ✅ AC-06 — `google-sign-in.test.ts` it.each "null display name and signs in when the name claim is %s (AC-06)" (missing, empty, spaces), `display-name.test.ts` null cases
- ✅ AC-07 — `google-sign-in.test.ts` "stores the first 50 code points of a longer Google name (AC-07)", `display-name.test.ts` truncation without splitting an emoji
- ✅ AC-08 — `google-sign-in.test.ts` "keeps the display name of a verified account when Google is linked, and on a repeat sign-in (AC-08)"
- ✅ AC-09 — `registration.test.ts` "answers an existing email exactly as a new one and keeps its display name (AC-09, NFR-02)" (status, body and content type byte for byte), `register-user.test.ts` "stores the display name on the created account only"
- ✅ AC-10 — `google-sign-in.test.ts` it.each "replaces the name typed at registration on a supersede with %s (AC-10)" (name, missing, empty, 60 emoji), `google-persistence.test.ts` "supersedeUnverified sets the display name in the same statement that removes the password (FR-07)" (`drizzle-user-repository.ts:66-78`, `complete-google-sign-in.ts:220`)

NFR-01 — `apps/api/test/perf/auth-latency.perf.test.ts` sends `displayName`, answers 202 for all 500
requests and keeps p95 below 500 ms. NFR-02 — the two byte-for-byte tests of AC-09 and the same 400
for an invalid name on a new and an existing email.

## Spec blocks

- ✅ Block 1 — shared schema field, NUL rule and the Google name rule: every task done, 8/8 required tests (`auth-schemas.test.ts`, `profile-schemas.test.ts`, `display-name.test.ts`)
- ✅ Block 2 — registration with a display name: every task done, 9/9 required tests (`registration.test.ts`, `register-user.test.ts`, `drizzle-user-repository.test.ts`, `auth-latency.perf.test.ts`)
- ✅ Block 3 — Google scope, claim and account creation: every task done, 10/10 required tests (`google-sign-in.test.ts`, `google-persistence.test.ts`, `google-oidc-identity-provider.test.ts`, `fake-google-oidc.test.ts`, `google-sign-in-races.test.ts`)
- ✅ Block 4 — registration screen and end-to-end helpers: every task done, 10/10 required tests (`register-container.test.tsx`, `form-errors.test.ts`, `display-name-error.test.ts`, `auth-form-accessibility.test.tsx`, e2e `auth.spec.ts`, `profile.spec.ts`, `google.spec.ts`)

## Tests

- ✅ Sad-path tests: `POST /auth/register` answers 400 for a missing, empty, whitespace-only, 51-character, NUL-containing and non-string display name, with no account and no email, and the same 400 for a new and an existing email; the schemas reject NUL, empty, oversized and 51-code-point names; `displayNameFromGoogleClaim` returns null for null, empty, spaces-only and NUL-only claims; the Google adapter reads a non-string `name` as missing and still fails with `claims_malformed` for a malformed `sub`, `email_verified`, `nonce` or `hd`; `supersedeUnverified` returns null and changes nothing for a verified account; the register form and the error mapper cover empty, whitespace-only, 51-character and NUL names.
- ✅ Threat model R-01 to R-09 each have the implementation and a test, except that R-02's escaped rendering and R-06's length cap are claimed without a dedicated test or code (see WARN below).

## Warnings (do not block)

- ⚠️ R-06 text versus code: the threat model says the adapter bounds the claim with a length cap, but `google-oidc-identity-provider.ts:42` is `name: z.string().optional().catch(undefined)` without a `.max()`. The risk is low (the verified token bounds its size and `displayNameFromGoogleClaim` reduces any string to 50 code points), so either the model text or the code needs a small correction in a later loop.
- ⚠️ W-VER-02 — `register-user.ts` branch coverage 75% (6/8) and `google-oidc-identity-provider.ts` function coverage 78.6% (11/14) are below 80%; the code added by this ticket is fully covered, the gaps look like older branches (for example `input.ip ?? UNKNOWN_IP`), and both files clear 80% lines.
- ⚠️ W-VER-03 — `register-user.test.ts` "stores nothing from a concurrent duplicate registration" only asserts that nothing was created, which the fake guarantees by construction; it does not assert the `existing` outcome or the discard row. The e2e tests use the fixed ports shared with other worktrees.
- ⚠️ W-VER-01 — `SubmittedValues` in `form-errors.ts` is exported but only used inside that file.
- ⚠️ The SAST report names `git diff feat/DISC-001-01d-profile...HEAD` as its scope; the base is now `origin/main` after the rebase (same diff).
- ⚠️ SAST Info items I-1 (a NUL name gets the "too long" message on the client), I-2 (positional parameters of `toValidationErrors`) and I-3 (the fake always lists `profile` in the scope it reports) remain accepted.

Result: PASSED

## Round 2 — after rebasing onto the Pesly rename (FEAT-002)

After PR #12 (the rename of the packages to `@pesly/*`) merged, the branch was rebased onto main
without conflicts. Two files of this ticket imported `@argent/shared` (`display-name.ts` and
`display-name-error.test.ts`); the commit `chore(identity): import the shared package under its
Pesly name` renamed those two imports, a mechanical change with no behavior change.

Re-run after the rebase and the rename: `pnpm install --frozen-lockfile` (already up to date),
`pnpm typecheck` clean, `pnpm exec eslint .` clean, `pnpm exec prettier --check --end-of-line auto .`
clean, `pnpm test:coverage` on `argent_01e_test`: 1148 passed, 0 failed, 0 skipped in 106 files, with
96.69% line, 92.82% branch and 93.50% function coverage repo-wide (the same coverage as in round 1,
the extra tests come from main), `pnpm exec playwright test` on `argent_01e_e2e`: 50 of 50 passed,
`pnpm audit --prod --audit-level high`: no known vulnerabilities. The acceptance criteria, spec
blocks and coverage of the files this ticket changed are those of round 1 above; nothing of the
ticket's behavior changed.

Result: PASSED
