# SAST report DISC-001-01a: Email & Password Authentication

| Field | Value |
|---|---|
| Ticket | DISC-001-01a |
| Tier | FEATURE |
| Date | 2026-09-28 |
| Scope | `apps/api/src`, `apps/web/src`, `packages/shared/src`, config (`eslint.config.mjs`, `playwright.config.ts`, vitest configs, `next.config.ts`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.gitignore`); tests for secrets only |
| Method | Manual review by `ddw-sec-auditor` against catalog §4, plus `pnpm audit --prod` and `pnpm audit` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 3 Low and 3 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): no production secret in the repository; `.env*` is gitignored except `.env.example` (`.gitignore:12-13`), no `.env`/`.pem`/`.key` tracked in history. Dev/CI/test credentials (`docker-compose.yml:8-9`, `.github/workflows/ci.yml:16-19`, `playwright.config.ts:15`, `apps/api/test/helpers/test-env.ts:22,34`) and `DUMMY_PASSWORD_HASH` (`apps/api/src/identity/infrastructure/security/argon2id-password-hasher.ts:20`) are false positives: never used in production. Low L-01 below.
- ✅ F-SAST-02 SQL injection (CWE-89): all queries use the Drizzle builder or parameterized `sql` templates; `sql.raw` at `apps/api/src/identity/infrastructure/db/schema.ts:36` only inlines escaped compile-time constants into CHECK DDL (false positive).
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`; the Mailpit SMTP client (`apps/api/src/identity/infrastructure/email/transports/mailpit-transport.ts:81,151-153`) rejects CR/LF in headers.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): no untrusted `JSON.parse`; non-string cookies dropped (`apps/api/src/shared/http/validate.ts:99-106`).
- ✅ F-SAST-05 Path traversal (CWE-22): no filesystem access on request paths; the dynamic import in `apps/web/src/i18n/request.ts:12` is guarded by `hasLocale` (false positive).
- ✅ F-SAST-06 XSS (CWE-79): no `dangerouslySetInnerHTML`/`innerHTML`; email HTML escaped (`apps/api/src/identity/infrastructure/email/render-email.ts:47-72`); nonce CSP with `strict-dynamic`. Info I-01 below.
- ✅ F-SAST-07 SSRF (CWE-918): HIBP URL constant (`apps/api/src/identity/infrastructure/security/hibp-breached-password-checker.ts:6`); email links only from `WEB_BASE_URL` (`render-email.ts:40-45`); no user-controlled URL fetched.
- ✅ F-SAST-08 Broken cryptography (CWE-327): Argon2id m=19456 t=2 p=1 (`argon2id-password-hasher.ts:9-14`); 32-byte random tokens hashed with SHA-256 (`apps/api/src/identity/infrastructure/security/crypto-token-generator.ts:4-13`); JWT HS256 pinned with iss/aud/typ/maxTokenAge (`apps/api/src/identity/infrastructure/security/jose-access-token-issuer.ts:37,58-68`); SHA-1 in HIBP is the k-anonymity protocol, not security use (false positive). Low L-02 below.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no stack traces in responses (`apps/api/src/shared/http/error-handler.ts:57-98`); `x-powered-by` disabled; production rejects console/Mailpit transports and the fake breach checker (`apps/api/src/shared/config/env.ts:19-42`). Low L-03 below.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): pino redaction of passwords, tokens, cookies, authorization and email fields (`apps/api/src/shared/logging/logger.ts:7-31`); error serializer drops query params and pg details (`logger.ts:71-130`); request logs omit query strings (`apps/api/src/app.ts:72`). Info I-02 below.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload or multipart handling; JSON body limit 16 KB (`apps/api/src/app.ts:18,121`).
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): `__Host-`/`__Secure-` cookies with `SameSite=Strict` (`apps/api/src/identity/infrastructure/http/session-cookies.ts:7-15`); global Origin + `X-Requested-With` guard on state-changing requests (`apps/api/src/shared/http/origin-guard.ts:12-21`); CORS limited to `WEB_ORIGIN` (`apps/api/src/app.ts:116`).
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod` — "No known vulnerabilities found"; CI enforces `--audit-level high` (`.github/workflows/ci.yml:42`).
- ✅ F-SAST-14 Incomplete input validation (CWE-20): every route validated with shared Zod schemas, loose schemas rejected at the type level (`apps/api/src/shared/http/validate.ts:24-32,71-75`); bounds on email, password, token, time zone and language.
- ✅ F-SAST-15 Insecure error handling (CWE-209): responses carry only a stable code and field paths; unknown errors map to 500 INTERNAL; anti-enumeration responses identical.
- ✅ F-SAST-16 Medium CVE in a dependency: FIXED. `pnpm audit` found esbuild <=0.24.2 (GHSA-67mh-4wv8-2f99, via drizzle-kit > @esbuild-kit/core-utils) and uuid <11.1.1 (GHSA-w5hq-g745-h8pq, via autocannon > hyperid), both dev-only. Resolved with `overrides` in `pnpm-workspace.yaml:13-15`; after the change `pnpm audit` reports "No known vulnerabilities found", `drizzle-kit check` passes, `pnpm test:coverage` 491/491 and `pnpm test:perf` 2/2 pass.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function`, `vm` or string `setTimeout`; `.exec` at `mailpit-transport.ts:103` is `RegExp.prototype.exec` (false positive).
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| L-01 | Low | `apps/api/src/shared/config/env.ts:21` | In production only the `change-me` JWT placeholder is rejected; the repo's CI/e2e/test secrets would pass if copied to production | Hardening follow-up: reject those prefixes and require ≥ 32 decoded random bytes |
| L-02 | Low | `apps/api/src/shared/config/env.ts:6` | `JWT_SECRET` length is measured in characters, not entropy | Same follow-up as L-01 |
| L-03 | Low | `apps/api/src/shared/config/env.ts:46` | `NODE_ENV` defaults to `development`; an unset value skips production checks. Compensating control: `EMAIL_PROVIDER=resend` refuses to start outside production (`env.ts:86-92`) | Hardening follow-up: make `NODE_ENV` required |
| I-01 | Info | `apps/web/src/lib/content-security-policy.ts:17` | `style-src-attr 'unsafe-inline'` allows inline style attributes (CSS only, no script) | Accepted: needed by Radix/shadcn |
| I-02 | Info | `.github/workflows/ci.yml:23`, `playwright.config.ts:33` | CI console email transport and Playwright traces contain test-user links | Accepted: throwaway test data |
| I-03 | Info | `docs/ddw/security/threat-DISC-001-01a.md` (R-18, database roles) | Threat model says a lint rule enforces scoped queries (it is the nominal `AccessScope` type plus a runtime check, which is stronger) and assumes a separate migration role (`apps/api/src/shared/db/migrate.ts:21` uses the same `DATABASE_URL`) | Documentation/deployment follow-up |

## Summary

Total: 17 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 2 dev-only
Medium CVEs fixed during this run; 3 Low and 3 Info documented.
