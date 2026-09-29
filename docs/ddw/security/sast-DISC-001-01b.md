# SAST report DISC-001-01b: Google Sign-In

| Field | Value |
|---|---|
| Ticket | DISC-001-01b |
| Tier | FEATURE |
| Date | 2026-09-28 |
| Scope | `git diff --ignore-cr-at-eol origin/main...HEAD` (89 files): `apps/api/src/identity/**` (Google port, adapter, use cases, routes, repositories, migration `0004` and rollback), `apps/api/src/shared/**` (env, validate, logger), `packages/shared/src/auth/google.ts`, `apps/web/src/**` (Google button, containers, catalogs), `playwright.config.ts`, tests and fixtures for secrets only |
| Method | Manual review by `ddw-sec-auditor` against catalog §4, plus `pnpm audit --prod` and `pnpm audit` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 1 Medium found and fixed (M-1); 6 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): fake OIDC client credentials exist only in test code and the Playwright config (`apps/api/test/fixtures/fake-google-oidc.ts:24-25`, `apps/api/test/helpers/test-env.ts:26-27`, `playwright.config.ts:17-20`) — false positive; production reads and requires them from the environment (`apps/api/src/shared/config/env.ts:71`); the fake server's RSA keys are generated at runtime (`fake-google-oidc.ts:195`); nothing under `src` imports the fixtures.
- ✅ F-SAST-02 SQL injection (CWE-89): Drizzle builder only (`apps/api/src/identity/infrastructure/db/drizzle-oauth-state-repository.ts:19-34`, `drizzle-user-identity-repository.ts:29-61`, `drizzle-user-repository.ts:68-79`); the one `sql` template is a column reference; migration `0004` and its rollback are static DDL.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the diff.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): `JSON.parse` of the token body (`apps/api/src/identity/infrastructure/security/google-oidc-identity-provider.ts:196`) runs on a response capped at 16 KB and read as fatal UTF-8 (`:233-251`), then a strict Zod schema (`:32`, `:149`) — false positive.
- ✅ F-SAST-05 Path traversal (CWE-22): no filesystem access in the diff.
- ✅ F-SAST-06 XSS (CWE-79): the Google mark is static JSX (`apps/web/src/features/auth/components/google-sign-in-button.tsx:11-32`); `?error=` is checked against a one-value allowlist and only a fixed catalog key is rendered (`apps/web/src/features/auth/containers/sign-in-container.tsx:12-26`); the link `href` comes from server `API_ORIGIN`.
- ✅ F-SAST-07 SSRF (CWE-918): `GOOGLE_*` URLs come from the environment and production pins them to Google (`env.ts:76`); the token request uses `redirect: 'error'` (`google-oidc-identity-provider.ts:179`); redirects to the web app are built only from `WEB_BASE_URL` (`apps/api/src/identity/infrastructure/http/google-routes.ts:35-36`).
- ✅ F-SAST-08 Broken cryptography (CWE-327): PKCE S256 (`google-oidc-identity-provider.ts:94-95`); 32-byte `randomBytes` tokens (`apps/api/src/identity/infrastructure/security/crypto-token-generator.ts:4-9`); state, binding and nonce stored as SHA-256; ID token pinned to RS256 with `aud`, `iss`, `maxTokenAge`, `azp` (`:205-220`); nonce compared with `timingSafeEqual` (`:224-228`).
- ✅ F-SAST-09 Debug mode in production (CWE-489): the unconfigured provider is only possible outside production (`env.ts:71`); the fake server and `console.info` are test-only.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): Google routes log only `requestId`, `ip`, `reason`, `userId`, `sessionId`, `via` (`google-routes.ts:43,47,68,73-76`); request and error logs strip the query string (`apps/api/src/app.ts:72`, `apps/api/src/shared/http/error-handler.ts:88`); jose errors are never kept as `cause`. I-2 below added the OAuth keys to the redaction list.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): not applicable.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): login CSRF prevented by the `__Secure-argent_oauth` binding cookie (HttpOnly, Secure, `SameSite=Lax`, `Path=/auth/google`) whose hash must match while the state is consumed atomically (`apps/api/src/identity/infrastructure/http/session-cookies.ts:23-27`, `drizzle-oauth-state-repository.ts:19-30`); `Lax` is required by Google's cross-site redirect; the cookie is single-use and cleared before any work (`google-routes.ts:62`). I-1 below.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod` and `pnpm audit` — "No known vulnerabilities found"; no `package.json` or lockfile change in this ticket.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): start query bounded (`packages/shared/src/auth/google.ts:21-24`); callback values ≤ 2048 chars, ≤ 5 repeats, unknown keys stripped (`:32-51`), repeated parameters refused (`apps/api/src/identity/application/complete-google-sign-in.ts:72`); ID token claims parsed by Zod (`google-oidc-identity-provider.ts:34-41`) plus `Email.parse`.
- ✅ F-SAST-15 Insecure error handling (CWE-209): every expected failure is the same fixed redirect (`google-routes.ts:36`); unexpected errors become generic 500 `INTERNAL`; the error serializer drops query parameters. I-3 below.
- ✅ F-SAST-16 Medium CVE in a dependency: none.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `dangerouslySetInnerHTML`; the only `RegExp.exec` is in a test fixture.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Fixed during this run

| ID | Severity | Location | Finding | Fix |
|---|---|---|---|---|
| M-1 | Medium (CWE-287) | `apps/api/src/identity/application/sign-in.ts:90-94` | A password-less (Google-created) user verified the public `DUMMY_PASSWORD_HASH`; submitting its preimage would have issued a session | Commit `09b800a`: the dummy hash is still verified for equal timing, then `user.passwordHash === null` is refused explicitly with `invalid_credentials`; test `apps/api/test/identity/sign-in-use-case.test.ts:235` (a hasher stub returning true) was red first with a session issued; threat R-34 reworded |

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info | `apps/api/src/identity/infrastructure/http/google-routes.ts:38-53` | `GET /auth/google/start` can be triggered cross-site: it can overwrite an in-flight binding cookie (aborting that sign-in) and spend the per-IP start budget | Accepted: nuisance only, no account effect; optional hardening (refuse `Sec-Fetch-Site: cross-site` on start) goes to the identity hardening ticket |
| I-2 | Info | `apps/api/src/shared/logging/logger.ts:7-17` | Redaction list lacked OAuth keys (nothing logged them) | Fixed in `09b800a`: `state`, `id_token`, `idToken`, `code_verifier`, `codeVerifier`, `client_secret`, `clientSecret`, `binding`, `nonce`, and `code` under query/body; tests `apps/api/test/foundation/logger.test.ts:129, 146` |
| I-3 | Info | `apps/api/src/shared/http/validate.ts:156` | A callback value over 2048 chars or with more than 5 repeats gets a JSON 400 instead of a redirect; the binding cookie then lives until its 10-minute expiry | Accepted: Google never sends either; nothing leaks |
| I-4 | Info | `apps/api/src/identity/infrastructure/db/schema.ts:180` | PKCE `code_verifier` stored in plaintext | Accepted by design (spec decision log): at most 10 minutes, deleted on use, useless without the code and client secret |
| I-5 | Info | `apps/api/src/identity/domain/google-authority.ts:9-13` | Any `hd` claim counts as authoritative whatever the email's domain | Accepted: matches Google's documented rule |
| I-6 | Info | `apps/api/drizzle/rollback/0004_google_identity.down.sql:1` | The rollback is destructive | Accepted: header documents the loss, precondition and "stop the API and worker first" (AGENTS.md explicit-plan rule) |

## Summary

Total: 17 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 1 Medium (M-1)
and 1 Info (I-2) fixed during this run; 5 Info accepted and documented.
