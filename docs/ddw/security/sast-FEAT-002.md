# SAST report FEAT-002: Rename the product from Argent to Pesly

| Field | Value |
|---|---|
| Ticket | FEAT-002 |
| Tier | FEATURE |
| Date | 2026-10-01 |
| Scope | diff of `feat/FEAT-002-rename-pesly` against `7ff1319`: `.railway/railway.ts`, `AGENTS.md`, web and email i18n catalogs, `apps/api/src/shared/config/env.ts`, `apps/api/scripts/build.mjs`, the `@argent/*` → `@pesly/*` imports and package manifests, `pnpm-lock.yaml`, `apps/web/next.config.ts`, `playwright.config.ts`, the tests, `docs/ddw/**` |
| Method | Manual review of the diff against catalog §4, plus `pnpm audit --prod --audit-level high` and `pnpm install --frozen-lockfile` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): no secret added; the renamed `EMAIL_FROM` fixtures and `LOCAL_EMAIL_FROM` are sender addresses, not credentials; Railway secrets stay `preserve()`.
- ✅ F-SAST-02 SQL injection (CWE-89): no query changed.
- ✅ F-SAST-03 OS command injection (CWE-78): `package-scope.test.ts` runs `git grep` through `spawnSync` with an argument array and no shell; its needles and pathspecs are code constants. The Railway build commands are constants with no interpolated input.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): `build.mjs` parses the repository's own `packages/shared/package.json` at build time and fails if it has no name.
- ✅ F-SAST-05 Path traversal (CWE-22): `build.mjs` resolves a fixed relative path from its own location; no input reaches a path.
- ✅ F-SAST-06 XSS (CWE-79): only catalog string values changed; they are rendered through next-intl as text, and no markup was added.
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request added.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography touched; the JWT issuer and audience are unchanged.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no configuration of the running services changed besides the build commands.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): no logging changed.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload handling in the diff.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the `X-Requested-With` value and the origin guard are unchanged.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` — "No known vulnerabilities found"; the lockfile diff only renames two workspace importer keys, which still link to `packages/shared`.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): no input path changed.
- ✅ F-SAST-15 Insecure error handling (CWE-209): no error path changed.
- ✅ F-SAST-16 Medium CVE in a dependency: `pnpm audit --prod` clean; dependency confusion is avoided because `@pesly/shared` stays `workspace:*`, resolved only inside the workspace, and installs are frozen.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `vm` in the diff.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Summary

Total: 19 categories clean, 0 vulnerabilities. Session cookies, the CSRF header value and the JWT
claims are unchanged, so no user is signed out.
