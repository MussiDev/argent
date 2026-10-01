# SAST report DISC-001-01e: Display Name at Sign-Up

| Field | Value |
|---|---|
| Ticket | DISC-001-01e |
| Tier | FEATURE |
| Date | 2026-10-01 |
| Scope | the code of `git diff feat/DISC-001-01d-profile...HEAD`: `packages/shared/src/{auth/register,profile/profile}.ts`, `apps/api/src/identity/**` (`domain/display-name.ts`, `register-user.ts`, `complete-google-sign-in.ts`, the user repository port and Drizzle adapter, the Google OIDC adapter), `apps/web/src/**` (registration form and container, `form-errors.ts`, `lib/display-name-error.ts`, `profile-errors.ts`, the two-factor callers of `toValidationErrors`), tests and fixtures for secrets only |
| Method | Manual review of the diff against catalog §4 plus targeted pattern searches over the touched files, and `pnpm audit --prod` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 3 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): no key, token or connection string in the diff; the only credentials-like literals are the fixed test passwords and the local test database URLs in tests; no `.env` file was added; nothing under `src` imports test data.
- ✅ F-SAST-02 SQL injection (CWE-89): Drizzle builder only; the registration insert (`apps/api/src/identity/infrastructure/db/drizzle-user-repository.ts:21`) and the supersede update (`drizzle-user-repository.ts:78`) bind `display_name` as a parameter; no `sql` template or string-built query in the diff.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the diff.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): no new `JSON.parse` of untrusted input in `src`; request bodies go through the shared Zod schema in the `validate` middleware, and the ID-token claims through the adapter's Zod schema (`apps/api/src/identity/infrastructure/security/google-oidc-identity-provider.ts:42`).
- ✅ F-SAST-05 Path traversal (CWE-22): no filesystem access in the diff.
- ✅ F-SAST-06 XSS (CWE-79): the display name typed at registration is only a form input value and, on the profile screen, a React text node or input value (no `dangerouslySetInnerHTML` or `innerHTML` in `apps/web/src`); the Google claim is reduced to a valid name or null before storage (`apps/api/src/identity/domain/display-name.ts:4`); the page runs under the existing nonce-based CSP.
- ✅ F-SAST-07 SSRF (CWE-918): no new outbound request; the only change in the Google flow is the `profile` scope on the authorization URL (`google-oidc-identity-provider.ts:93`), which still points at the configured Google endpoints.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added or changed.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flags and no new environment variables.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the registration route still logs only the outcome and user id (`apps/api/src/identity/infrastructure/http/registration-routes.ts:49`), the Google route only the user id, path and reason; the claim and the name are never logged, and tests assert that no display name or email reaches the registration and Google log lines.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): not applicable.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): `POST /auth/register` keeps the global Origin plus `X-Requested-With` guard; the Google flow keeps its state, nonce, PKCE and binding cookie, and no new state-changing route was added.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` — "No known vulnerabilities found"; no dependency was added or changed.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): `displayName` is required and validated by `displayNameSchema` (trim, UTF-16 cap, NUL rejected, 1 to 50 code points) in `packages/shared/src/auth/register.ts:12` and `packages/shared/src/profile/profile.ts:16`, before the use case runs and before any email lookup; the Google `name` is parsed apart and leniently while `sub`, `email`, `email_verified`, `hd` and `nonce` stay strict (`google-oidc-identity-provider.ts:42`) and then reduced by `displayNameFromGoogleClaim` (NUL removed, trimmed, truncated to 50 code points); the database check constraint repeats the length rule.
- ✅ F-SAST-15 Insecure error handling (CWE-209): an invalid name answers 400 with field paths only; the response for an already registered email is identical to the one for a new email (tested byte for byte); a malformed `name` claim never fails a sign-in and never leaks into an error.
- ✅ F-SAST-16 Medium CVE in a dependency: none; no dependency change.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function`, `dangerouslySetInnerHTML`, `innerHTML` or `Math.random` in the touched source files.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Account takeover and enumeration review

- Anti-enumeration: the name is validated in the `validate` middleware before `RegisterUser.execute`, so a bad name is a 400 for any email; the existing-email branch never reads or stores the name (`apps/api/src/identity/application/register-user.ts:63`), the created branch is the only writer (`register-user.ts:74`), and the 202 body is identical.
- Name writes in the Google flow: only the create branch (`apps/api/src/identity/application/complete-google-sign-in.ts:246`) and the supersede branch (`complete-google-sign-in.ts:220`, which replaces the text typed by whoever registered the unverified account with the Google holder's own reduced name) write it; linking a verified account and repeat sign-ins never do (tests for AC-08 and AC-10).

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info | `apps/web/src/lib/display-name-error.ts:1` | A name containing a NUL character gets the "too long" message on the client (the rule distinguishes only empty from not empty); the API rejects it correctly | Accepted: UX only, reachable only by pasting a NUL |
| I-2 | Info | `apps/web/src/features/auth/form-errors.ts:1` | `toValidationErrors(error, submitted = {}, codeError)` takes two optional positional parameters, so three callers pass `{}`; a caller that forgets the submitted values would show the "required" message for an over-long name | Accepted: the compiler rejects the old argument order and only the registration screen maps this field; an options object is a possible cleanup |
| I-3 | Info | `apps/api/test/fixtures/fake-google-oidc.ts:1` | The fake always lists `profile` in the approve redirect and token response scope even when the authorization did not request it; only the ID-token claim honors the requested scope | Accepted: test fixture only |

## Summary

Total: 17 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 3 Info documented.
