# SAST report FIX-005: Cap the worker and web containers on Railway

| Field | Value |
|---|---|
| Ticket | FIX-005 |
| Tier | FIX |
| Date | 2026-10-01 |
| Scope | diff of `fix/FIX-005-railway-container-limits` against `8bc09d2`: `.railway/railway.ts`, `apps/api/test/deploy/railway-iac.test.ts`, `docs/ddw/**` |
| Method | Manual review of the diff against catalog §4, plus `pnpm audit --prod --audit-level high` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): `TOTP_ENCRYPTION_KEY` is declared as `preserve()` in `.railway/railway.ts`, with no value; the test lists it among the secrets that must never have a value, so a literal would fail naming it.
- ✅ F-SAST-02 SQL injection (CWE-89): no query added.
- ✅ F-SAST-03 OS command injection (CWE-78): no command changed; start commands are unchanged.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): no deserialization added.
- ✅ F-SAST-05 Path traversal (CWE-22): no filesystem access added.
- ✅ F-SAST-06 XSS (CWE-79): no HTML output added.
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request added.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography touched; the TOTP key keeps the value Railway holds.
- ✅ F-SAST-09 Debug mode in production (CWE-489): `NODE_ENV=production` unchanged on every service.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the plans were read with values redacted; no secret was printed.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload handling in the diff.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): no route changed.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` — "No known vulnerabilities found"; no dependency change.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): the definition takes no runtime input; `containerMemoryIssues` enforces the memory floor in CI.
- ✅ F-SAST-15 Insecure error handling (CWE-209): no error path added.
- ✅ F-SAST-16 Medium CVE in a dependency: `pnpm audit --prod` clean.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `vm` in the diff.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Summary

Total: 19 categories clean, 0 vulnerabilities. The change bounds the cost of a runaway on the
worker and web, and keeps an encryption key from being deleted by an apply.
