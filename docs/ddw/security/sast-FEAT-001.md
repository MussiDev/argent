# SAST report FEAT-001: Define the Pesly Railway services as Infrastructure as Code

| Field | Value |
|---|---|
| Ticket | FEAT-001 |
| Tier | FEATURE |
| Date | 2026-10-01 |
| Scope | diff of `feat/FEAT-001-railway-iac` against `3cdd215`: `.railway/railway.ts`, `apps/api/test/deploy/railway-iac.test.ts`, `scripts/railway-config.mjs`, `scripts/railway-config.d.mts`, `apps/api/test/deploy/railway-cli-wrapper.test.ts`, `package.json`, `apps/api/package.json`, `pnpm-lock.yaml`, `tsconfig.json`; deleted `apps/api/railway.json`, `apps/api/railway.worker.json`, `apps/web/railway.json`, `apps/api/test/deploy/railway-config.test.ts`; `docs/ddw/**` |
| Method | Manual review of the diff against catalog §4, plus `pnpm audit --prod --audit-level high` and `pnpm audit --audit-level high` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 0 Low |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): `.railway/railway.ts` declares `JWT_SECRET`, `RESEND_API_KEY`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as `preserve()` and `DATABASE_URL` as a reference to `argent-postgres`; the only literals are public settings (origins, sender, log level). The test's sad-path values (`not-a-real-secret`, `re_fake`) are not credentials. No `railway config pull` output was committed.
- ✅ F-SAST-02 SQL injection (CWE-89): no query added.
- ✅ F-SAST-03 OS command injection (CWE-78): the build, start and pre-deploy commands in `.railway/railway.ts` are constants with no interpolated input. `scripts/railway-config.mjs` accepts only `plan` or `apply` as its subcommand, passes every argument to `spawnSync` as an array with `shell: false`, and resolves npm's `railway.cmd` shim to the `railway.exe` beside it so no `.cmd` file is ever run; its only shell call is the fixed string `command -v railway`, with no input. No process execution was added to application code.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): the test parses the repository's own `package.json` files only.
- ✅ F-SAST-05 Path traversal (CWE-22): the test walks `apps/` from a fixed repository root and reads fixed file names; no user input reaches a path.
- ✅ F-SAST-06 XSS (CWE-79): no HTML output added.
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request added; the `railway` SDK builds plain objects and makes no network call (verified in `dist/iac/index.js`).
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography touched.
- ✅ F-SAST-09 Debug mode in production (CWE-489): every service declares `NODE_ENV=production` and the API keeps `LOG_LEVEL=info`; the test asserts `NODE_ENV`.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the plan was read with values redacted; only three non-secret values were shown, and secrets are never printed because they are preserved.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload handling in the diff.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): no route changed.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` and `pnpm audit --audit-level high` — "No known vulnerabilities found".
- ✅ F-SAST-14 Incomplete input validation (CWE-20): the definition takes no runtime input; its shape is checked by the SDK types (`pnpm typecheck`) and by the test.
- ✅ F-SAST-15 Insecure error handling (CWE-209): no error path added to application code.
- ✅ F-SAST-16 Medium CVE in a dependency: `pnpm audit --audit-level high` clean, development dependencies included; `railway` 3.12.0 has no install script.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `vm` in the diff.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Low and informational findings (W-SAST-01)

(none)

## Summary

Total: 19 categories clean, 0 vulnerabilities (0 critical, 0 high, 0 medium, 0 low). A secret given a
literal value, or handed to another service by reference, fails the test naming the variable.
