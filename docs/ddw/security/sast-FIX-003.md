# SAST report FIX-003: Give the email worker its own environment schema without Google credentials

| Field | Value |
|---|---|
| Ticket | FIX-003 |
| Tier | FIX |
| Date | 2026-09-30 |
| Scope | diff of `fix/FIX-003-worker-env-schema` against `origin/main`: `apps/api/src/shared/config/env.ts`, `apps/api/src/worker.ts`, `playwright.config.ts`, `apps/api/test/foundation/worker-env.test.ts`, `docs/ddw/**` |
| Method | Manual review of the diff against catalog §4, plus `pnpm audit --prod --audit-level high` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 0 Low |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): no production secret added. `worker-env.test.ts` uses fixture values (`re_worker_test_key_…`, a fake database password) that are not real credentials; `playwright.config.ts` keeps the e2e fakes already in the repository.
- ✅ F-SAST-02 SQL injection (CWE-89): no query added.
- ✅ F-SAST-03 OS command injection (CWE-78): no process execution added.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): the environment is validated by zod schemas; no untrusted data is deserialized.
- ✅ F-SAST-05 Path traversal (CWE-22): no filesystem access added.
- ✅ F-SAST-06 XSS (CWE-79): no HTML output added.
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request added; the Google endpoint checks stay in the API schema.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography touched.
- ✅ F-SAST-09 Debug mode in production (CWE-489): the worker keeps its production checks (`resend` only, `https:` links) in `workerProductionIssues` (`apps/api/src/shared/config/env.ts`), tested by `worker-env.test.ts`.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): startup errors go through one `parseWith` helper that prints variable names and rule messages only; `worker-env.test.ts` asserts no provided value appears in the message.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload handling in the diff.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): no route changed.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` — "No known vulnerabilities found"; no dependency change.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): the worker's seven settings keep the same zod rules as before; the API schema is unchanged (`env.test.ts` green without edits).
- ✅ F-SAST-15 Insecure error handling (CWE-209): the worker fails fast with a named, value-free error, as before.
- ✅ F-SAST-16 Medium CVE in a dependency: `pnpm audit --prod` clean.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `vm` in the diff.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Low and informational findings (W-SAST-01)

(none)

## Summary

Total: 19 categories clean, 0 vulnerabilities (0 critical, 0 high, 0 medium, 0 low). The change
reduces exposure: once the Railway variables are removed, the worker no longer holds `JWT_SECRET`
or the Google client secret.
