# SAST report FIX-004: Concurrent Google callbacks fail intermittently with google_failed

| Field | Value |
|---|---|
| Ticket | FIX-004 |
| Tier | FIX |
| Date | 2026-10-01 |
| Scope | diff of `fix/FIX-004-google-race-flaky` against `72b5732`: `apps/api/src/identity/application/complete-google-sign-in.ts`, `apps/api/test/identity/google-sign-in-races.test.ts`, `docs/ddw/**` |
| Method | Manual review of the diff against catalog §4, plus `pnpm audit --prod --audit-level high` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): no secret added; the tests use fixture subjects and emails.
- ✅ F-SAST-02 SQL injection (CWE-89): the added read goes through `findUserByProviderSubject`, a parameterized Drizzle query; no SQL is built from strings.
- ✅ F-SAST-03 OS command injection (CWE-78): no process execution added.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): no deserialization added; claims still come from the verified ID token.
- ✅ F-SAST-05 Path traversal (CWE-22): no filesystem access added.
- ✅ F-SAST-06 XSS (CWE-79): no HTML output added; the redirect targets are unchanged.
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request added.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography touched.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no configuration changed.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): no logging added; the route keeps logging user and session ids only.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload handling in the diff.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the callback keeps its single-use state bound to the browser cookie; no route changed.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` — "No known vulnerabilities found"; no dependency change.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): the callback query is still validated by the shared schema; the new branch signs in only when the identity found has the token's own `sub` (`complete-google-sign-in.ts`, `sameAccount?.id === existing.id`), so a different Google account is still refused.
- ✅ F-SAST-15 Insecure error handling (CWE-209): unchanged; unexpected faults still propagate to the error middleware.
- ✅ F-SAST-16 Medium CVE in a dependency: `pnpm audit --prod` clean.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `vm` in the diff.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Informational findings (W-SAST-01)

(none)

## Summary

Total: 19 categories clean, 0 vulnerabilities. The fix removes a false refusal without widening who
can sign in: the user returned is the one linked to the token's own Google subject.
