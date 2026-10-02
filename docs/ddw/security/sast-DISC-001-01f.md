# SAST report DISC-001-01f: Account Deletion

| Field | Value |
|---|---|
| Ticket | DISC-001-01f |
| Tier | FEATURE |
| Date | 2026-10-02 |
| Scope | the source of `git diff origin/main...HEAD` (40 non-test source files): `packages/shared/src/{profile/delete-user,profile/profile,errors}.ts`, `apps/api/src/identity/**` (deletion use cases, repositories, routes, cookies, OIDC adapter, email worker purge, schema and migration 0010), `apps/web/src/{lib/api-client.ts,features/profile/**,components/ui/button.tsx,app/[locale]/(app)/settings/delete-account/page.tsx}` and the message catalogs |
| Method | Manual review of the diff against catalog §4, targeted pattern searches over the touched files (unsafe functions, raw SQL, logging calls, cookie options, browser storage, NUL bytes), and `pnpm audit --prod --audit-level high` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 4 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): no key, token or connection string in the source diff; the only credential-like literals are fixed test passwords and the local test database URLs in tests; no `.env` file was added; the grant token is generated at runtime (32 random bytes) and only its SHA-256 hash is stored (`apps/api/src/identity/application/complete-deletion-reauth.ts:80`).
- ✅ F-SAST-02 SQL injection (CWE-89): Drizzle builder and `sql` templates with bound parameters only; `apps/api/src/identity/infrastructure/db/drizzle-deletion-grant-repository.ts:17` binds the user id into `pg_advisory_xact_lock(hashtext(...))`, `apps/api/src/identity/infrastructure/db/drizzle-user-deletion-repository.ts:51` binds it into the outbox payload filter, and `apps/api/src/identity/infrastructure/db/drizzle-user-deletion-repository.ts:29` is a constant `set local lock_timeout`; the one `sql.raw` (`apps/api/src/identity/infrastructure/db/schema.ts:42`) is the pre-existing check-constraint helper, fed only by compile-time constants.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the diff.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): no new `JSON.parse` of untrusted input; the request body goes through `deleteUserRequestSchema` in the shared `validate` middleware (`apps/api/src/identity/infrastructure/http/profile-routes.ts:96`) and the new `auth_time` claim through the OIDC adapter's lenient Zod schema (`apps/api/src/identity/infrastructure/security/google-oidc-identity-provider.ts:44`).
- ✅ F-SAST-05 Path traversal (CWE-22): no filesystem access in the source diff; the grant cookie path `/profile/delete` is a constant (`apps/api/src/identity/infrastructure/http/session-cookies.ts:59`).
- ✅ F-SAST-06 XSS (CWE-79): the delete-account screen renders only catalog strings and React text nodes; no `dangerouslySetInnerHTML` or `innerHTML` in `apps/web/src`; the `reauth` query flag is read through a strict whitelist (`ready`, `failed`) in `apps/web/src/features/profile/containers/delete-user-container.tsx:1`.
- ✅ F-SAST-07 SSRF (CWE-918): no new outbound request; the Google re-authentication builds its authorization URL from the configured endpoints and only adds `prompt=login` and `max_age=0` (`apps/api/src/identity/infrastructure/security/google-oidc-identity-provider.ts:105`).
- ✅ F-SAST-08 Broken cryptography (CWE-327): grant tokens are 32 bytes from the existing token generator hashed with SHA-256; no MD5, SHA-1, DES or ECB, and no new password handling (the password check reuses the existing hasher).
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flags and no new environment variables.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the new routes log only request id, ip, user id, outcome and reason (`apps/api/src/identity/infrastructure/http/profile-routes.ts:104`, `apps/api/src/identity/infrastructure/http/google-routes.ts:74`); the logger redacts `secondFactorCode`, `grantToken`, `grant` and `authorizationUrl` (`apps/api/src/shared/logging/logger.ts:1`); a test asserts that the authorization URL, state, nonce, code, binding, grant, email and subs never appear in log lines; the web code has no `console.*` and no browser storage.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): not applicable.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): `POST /profile/delete` and `POST /profile/delete/google/start` sit behind the global Origin plus `X-Requested-With` guard and `requireSession`; the grant cookie is `__Secure-` prefixed, HttpOnly, Secure, SameSite Strict and scoped to `/profile/delete` (`apps/api/src/identity/infrastructure/http/session-cookies.ts:14`); the Google callback keeps state, nonce, PKCE and the binding cookie.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` reports "No known vulnerabilities found"; no dependency was added or changed.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): the deletion body is validated by `deleteUserRequestSchema` (`packages/shared/src/profile/delete-user.ts:1`: password length cap, second-factor code format); the callback state, code and binding cookie keep their existing validation; the grant cookie is hashed before lookup and never trusted as an identifier.
- ✅ F-SAST-15 Insecure error handling (CWE-209): a missing, expired, consumed or mismatched grant answers the typed 401 `REAUTHENTICATION_REQUIRED` and a wrong password `INVALID_CREDENTIALS`, with no internals; a failed Google re-authentication redirects with `?reauth=failed` and no reason in the URL (`apps/api/src/identity/infrastructure/http/google-routes.ts:71`).
- ✅ F-SAST-16 Medium CVE in a dependency: none; no dependency change.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function`, `dangerouslySetInnerHTML`, `innerHTML`, `Math.random` or weak hash in the touched source files; no NUL bytes in any touched file.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Re-authentication and erasure review

- Sign-in and deletion never share an outcome: the shared Google callback dispatches by the stored OAuth state purpose right after ID-token verification and before any account resolution (`apps/api/src/identity/application/complete-google-sign-in.ts:146`), so a deletion state can never create a session and a sign-in state can never issue a grant (tested at use-case level in `apps/api/test/identity/deletion-reauth-dispatch.test.ts`).
- Grant lifecycle: single use (consumed inside the erase transaction), 5 minutes, bound to user, session family and credentials version, replaced atomically under an advisory lock (`apps/api/src/identity/infrastructure/db/drizzle-deletion-grant-repository.ts:17`); a user with a password never uses the grant path (`apps/api/src/identity/application/delete-user.ts:88`).
- Erasure: one transaction, outbox rows first with `FOR UPDATE SKIP LOCKED`, then the grant consume and the user delete (`apps/api/src/identity/infrastructure/db/drizzle-user-deletion-repository.ts:29`); a guard test walks `pg_constraint` from `users` and fails on any unregistered table or non-cascading foreign key.
- Accepted risk R-09 (threat model, owner decision 2026-10-02): `auth_time` is enforced only when Google returns it; otherwise `prompt=login` plus the single-use state carry the freshness. Manual post-deploy verification with a real Google account is still open.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info | `apps/web/src/components/ui/button.tsx:13` | The new `destructive` variant uses `text-white`, the stock shadcn value, because `globals.css` has no `--destructive-foreground` token | Accepted: styling only; add the token in a design pass |
| I-2 | Info | `apps/web/src/features/profile/containers/delete-user-container.tsx:1` | The `?reauth=ready` flag stays in the URL after load, so a reload after the grant expired shows the confirmed state; the API answers `REAUTHENTICATION_REQUIRED` and the screen offers to start again | Accepted: the flag is not a secret and the server is the authority |
| I-3 | Info | `apps/api/src/identity/application/complete-deletion-reauth.ts:60` | A Google-created account with neither a password nor a linked Google identity cannot re-authenticate and ends in `REAUTHENTICATION_REQUIRED` | Accepted: decision O-2, recorded in the spec |
| I-4 | Info | `apps/web/e2e/support/fake-google.ts:1` | The e2e fake runs in a separate process, so `prompt=login` is asserted on the authorization query the browser received, not on a fake-side request log | Accepted: the adapter side is covered by `apps/api/test/identity/google-oidc-identity-provider.test.ts` |

## Summary

Total: 17 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 4 Info documented.
