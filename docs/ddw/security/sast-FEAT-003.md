# SAST report FEAT-003: Available balance vs net worth

| Field | Value |
|---|---|
| Ticket | FEAT-003 |
| Tier | FEATURE |
| Date | 2026-10-02 |
| Scope | diff of `feat/FEAT-003-available-balance` against `origin/main`: `packages/shared/src/accounts/account.ts`, `packages/shared/src/errors.ts`, `apps/api/drizzle/0011_account_include_in_available.sql` with its snapshot, journal entry and rollback scripts, `apps/api/src/accounts/**` (domain, use cases, Drizzle repository, routes, presenter), `apps/api/src/shared/http/error-handler.ts`, `apps/web/src/lib/api-client.ts`, `apps/web/src/components/ui/checkbox.tsx`, `apps/web/src/features/accounts/**`, the es and en catalogs, and the tests |
| Method | Manual review of the diff against catalog §4, targeted greps over the changed sources (secrets, string-built SQL, exec and eval, `innerHTML`, outbound requests, logging, file access), plus `pnpm audit --prod --audit-level high` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the grep for credential-like assignments over the changed sources returned nothing; no secret, key or connection string was added, and `.env` stays untracked.
- ✅ F-SAST-02 SQL injection (CWE-89): the new queries use Drizzle with bound parameters (`apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts` `setIncludeInAvailable`, `.for('update')`, `scopedRow`); the only `sql.raw` in the touched files is the existing `oneOf` helper in `schema.ts:25`, fed by compile-time constants; the migration is static SQL with no interpolation.
- ✅ F-SAST-03 OS command injection (CWE-78): no `exec`, `spawn` or shell call in the changed sources; the grep found none.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): request bodies are parsed by Zod schemas (`setIncludeInAvailableRequestSchema`, `createAccountRequestSchema`); no `JSON.parse` of untrusted data was added to the sources.
- ✅ F-SAST-05 Path traversal (CWE-22): the account id reaches the client path only through the existing `accountPath` guard in `apps/web/src/lib/api-client.ts`, which refuses `.`, `..` and separators, and the route validates it as a UUID; no file path is built from input.
- ✅ F-SAST-06 XSS (CWE-79): the new components render account names and amounts as React text (`apps/web/src/features/accounts/components/account-row.tsx`, `accounts-headline.tsx`); no `dangerouslySetInnerHTML` or `innerHTML` anywhere in the diff.
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request was added on the server; the browser calls only the configured API base URL through the existing `request` helper in `apps/web/src/lib/api-client.ts:198`.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added or touched.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no configuration or debug flag changed.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the new audit line in `apps/api/src/accounts/infrastructure/http/account-routes.ts:160` logs request id, user id, account id and the boolean only, and a test asserts neither the name nor an amount appears; `error-handler.ts` logs codes and routes, not bodies.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload handling in the diff.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the new `PUT /accounts/:id/include-in-available` sits behind `requireSession`, `requireVerifiedEmail` and the existing origin guard with `X-Requested-With`; a test shows it answers 403 without the headers.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` — "No known vulnerabilities found"; no dependency was added or changed (the checkbox is a native input).
- ✅ F-SAST-14 Incomplete input validation (CWE-20): the new body is a strict boolean (strings, numbers and null fail with 400 naming `body.includeInAvailable`), the id is a UUID, a credit card created as included fails validation, and PATCH rejects the field; tests cover each.
- ✅ F-SAST-15 Insecure error handling (CWE-209): `AppError` now carries optional `fields`, emitted by `mapError` in `apps/api/src/shared/http/error-handler.ts` as fixed field paths declared by the domain error (`body.includeInAvailable`), never submitted values or messages; a test asserts the message is not echoed.
- ✅ F-SAST-16 Medium CVE in a dependency: `pnpm audit --prod` is clean; the lockfile is unchanged.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `vm` in the diff; the grep found none.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Summary

Total: 19 categories clean, 0 vulnerabilities. Authorization is unchanged in kind: every repository statement stays scoped by owner (the new locked read and the update both use `scopedRow`), another user's account answers 404 identical to a missing id, and the database CHECK `accounts_credit_card_not_available_check` backs the credit card rule behind the validation.
