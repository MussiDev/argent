# SAST report FIX-002: Align Railway deployment with the monorepo and cap runtime memory

| Field | Value |
|---|---|
| Ticket | FIX-002 |
| Tier | FIX |
| Date | 2026-09-28 (re-run after the corrective loop, 2026-09-29) |
| Scope | diff of `fix/FIX-002-railway-deploy` against `main`: `apps/api/scripts/build.mjs`, `apps/api/railway.json`, `apps/api/railway.worker.json`, `apps/web/railway.json`, `apps/api/package.json`, `apps/web/package.json`, `pnpm-lock.yaml`, `AGENTS.md`, `apps/api/test/deploy/*.test.ts`, `apps/web/test/start-script.test.ts`, `docs/ddw/**` |
| Method | Manual review of the diff against catalog §4, plus `pnpm audit --prod --audit-level high` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 0 Low |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the three `railway*.json` files hold commands only and no `variables` key (asserted by `apps/api/test/deploy/railway-config.test.ts:53-54`); `build.mjs` defines no `process.env` substitution, and `apps/api/test/deploy/build-output.test.ts:86` asserts a canary environment value never reaches the bundles. The test database URL in `docs/ddw/reports/tests-FIX-002.md:6` and the unreachable URL in `build-output.test.ts:110` carry the local Docker credentials already public in `docker-compose.yml:8-9` (false positive, never used in production). `.env*` stays ignored (`.gitignore:12`).
- ✅ F-SAST-02 SQL injection (CWE-89): no application query added; the test's schema resets are constant statements (`build-output.test.ts:39-43`).
- ✅ F-SAST-03 OS command injection (CWE-78): the tests spawn `process.execPath` with fixed argument arrays and no shell (`build-output.test.ts:35-37`); `build.mjs` spawns nothing. The Railway start commands are static strings from the repository; the web one runs the locked Next.js binary directly (`apps/web/railway.json:10`) with no shell expansion of runtime input.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): `JSON.parse` only reads repository files in tests (`railway-config.test.ts:18`, `start-script.test.ts:4`).
- ✅ F-SAST-05 Path traversal (CWE-22): `build.mjs` takes `--outdir` and entry points from its own command line at build time (`apps/api/scripts/build.mjs:25-36`), set by the repository's scripts, never by a user request.
- ✅ F-SAST-06 XSS (CWE-79): no HTML output in the diff.
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request added; the migration connects to `DATABASE_URL` as before.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography touched.
- ✅ F-SAST-09 Debug mode in production (CWE-489): the bundle carries source maps (`build.mjs:52`) written next to the API bundle inside the container; the API serves no static files, so they are never exposed over HTTP. Production-only checks depend on `NODE_ENV=production`, set in Railway per threat R-05 (manual step, outside the repository).
- ✅ F-SAST-10 Logging sensitive data (CWE-532): no log statement added.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload handling in the diff.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): no route changed.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` — "No known vulnerabilities found"; the only added package is the dev-time `esbuild` ^0.28.2, already resolved in `pnpm-lock.yaml` through `tsx`.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): no new runtime input; the web keeps validating `API_ORIGIN` in `apps/web/src/lib/web-env.ts`, and `PORT` is read by Next.js itself.
- ✅ F-SAST-15 Insecure error handling (CWE-209): the build exits 1 after esbuild prints its own errors (`build.mjs:55-58`); the migration keeps its existing message naming only the missing variable.
- ✅ F-SAST-16 Medium CVE in a dependency: `pnpm audit --prod` clean.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `vm` in the diff.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Low and informational findings (W-SAST-01)

(none)

## Summary

Total: 19 categories clean, 0 vulnerabilities (0 critical, 0 high, 0 medium, 0 low).
