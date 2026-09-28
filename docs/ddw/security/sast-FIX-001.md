# SAST report FIX-001: Fix review edge cases in session refresh and sign-in refund

| Field | Value |
|---|---|
| Ticket | FIX-001 |
| Tier | FIX |
| Date | 2026-09-28 |
| Scope | diff of `fix/FIX-001-auth-review-edge-cases` against `feat/DISC-001-01a-email-password-auth`: `apps/api/src/identity/application/refresh-session.ts`, `apps/api/src/identity/application/sign-in.ts`, `apps/api/src/identity/application/ports/session-repository.ts`, the three test files, `AGENTS.md`, `docs/ddw/**` |
| Method | Manual review of the diff against catalog §4, plus `pnpm audit --prod --audit-level high` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 0 Low |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): no secret added. The test database URL in `docs/ddw/reports/tests-FIX-001.md:6` carries the local Docker credentials already public in `docker-compose.yml:8-9` (false positive, never used in production).
- ✅ F-SAST-02 SQL injection (CWE-89): no query added; the re-read uses `SessionRepository.findById` (`apps/api/src/identity/application/refresh-session.ts:85`), a Drizzle `eq` on the primary key (`apps/api/src/identity/infrastructure/db/drizzle-session-repository.ts:23-26`).
- ✅ F-SAST-03 OS command injection (CWE-78): no process execution in the diff.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): no parsing of untrusted data in the diff.
- ✅ F-SAST-05 Path traversal (CWE-22): no filesystem access in the diff.
- ✅ F-SAST-06 XSS (CWE-79): no HTML output in the diff.
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request in the diff.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography touched; refresh tokens keep their SHA-256 hash lookup.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug output added; errors still reach the shared error handler.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the only new log path is `reportRefundFailure` on the rate-limited branch (`apps/api/src/identity/application/sign-in.ts:98`), wired to `logger.warn({ err })` through the safe error serializer (`apps/api/src/identity/index.ts:208-213`); no email, IP or token is added to it.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload handling in the diff.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): no route changed; the existing Origin guard and `SameSite=Strict` cookies still front `/auth/refresh` and `/auth/sign-in`.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` — "No known vulnerabilities found"; no dependency added.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): no new input; routes keep their shared Zod schemas.
- ✅ F-SAST-15 Insecure error handling (CWE-209): a failed refund on a refused sign-in now answers 429 `RATE_LIMITED` instead of 500 `INTERNAL` (`apps/api/src/identity/application/sign-in.ts:92-100`); a re-read failure after a lost claim propagates to the error handler as 500 `INTERNAL` with no internals exposed.
- ✅ F-SAST-16 Medium CVE in a dependency: `pnpm audit --prod` clean; no dependency change.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `vm` in the diff.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Low and informational findings (W-SAST-01)

(none)

## Summary

Total: 19 categories clean, 0 vulnerabilities (0 critical, 0 high, 0 medium, 0 low).
