# SAST report DISC-001-02a: Accounts

| Field | Value |
|---|---|
| Ticket | DISC-001-02a |
| Tier | FEATURE |
| Date | 2026-10-01 |
| Scope | `git diff --ignore-cr-at-eol origin/main...HEAD` without `docs/`: `packages/shared/src/money.ts`, `accounts/account.ts`, `errors.ts`; `apps/api/src/accounts/**`, `apps/api/src/shared/db/pg-errors.ts`, identity `unique-violation.ts`, `apps/api/src/server.ts`, `error-handler.ts`; migration `0006_accounts` with its rollback, snapshot and journal; `apps/web/src/features/accounts/**`, `components/ui/select.tsx`, the accounts pages, `api-client.ts`, catalogs; tests, e2e and perf files for secrets only |
| Method | Manual review by `ddw-sec-auditor` against catalog §4, plus `pnpm audit --prod --audit-level high` and `pnpm audit` run by the orchestrator |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 1 Low and 3 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the diff holds no keys or tokens; the only credentials are test fixtures (`apps/api/test/accounts/account-routes.test.ts` passphrase constant and the passphrase in `apps/web/e2e/accounts.spec.ts`), which never reach `src`.
- ✅ F-SAST-02 SQL injection (CWE-89): the repository uses Drizzle builders and parameter-bound `sql` fragments only (`apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts:86-95`); `sql.raw(literals)` in `apps/api/src/accounts/infrastructure/db/schema.ts:26` receives compile-time constants with quotes escaped, at schema-definition time; the migration and rollback are static DDL. Test-only string-built SQL (`apps/api/test/accounts/account-repository.test.ts:268`) interpolates test constants and self-generated UUIDs — see I-4.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the diff.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): input is parsed by `express.json` and the shared Zod schemas through `validate`; `BigInt(body.openingBalance)` (`apps/api/src/accounts/infrastructure/http/account-routes.ts:81`) only receives a string already checked against `^-?(0|[1-9]\d*)$` and the int64 range (`packages/shared/src/money.ts:6-17`).
- ✅ F-SAST-05 Path traversal (CWE-22): the API does no file I/O in this scope; the web client rejects the ids `''`, `.` and `..` and encodes the rest (`apps/web/src/lib/api-client.ts` `accountPath`), and the server requires a UUID (`packages/shared/src/accounts/account.ts:55`).
- ✅ F-SAST-06 XSS (CWE-79): no `dangerouslySetInnerHTML`, `innerHTML` or `eval` under `apps/web/src/features/accounts`, `select.tsx` or the pages; account names render only as React text nodes (`apps/web/src/features/accounts/components/account-list.tsx:77,159,184`); a test renders a name with markup as literal text.
- ✅ F-SAST-07 SSRF (CWE-918): no server-side outbound request was added; the web client uses the fixed API origin plus an encoded UUID segment.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no crypto in this module; ids come from `gen_random_uuid()` (`apps/api/drizzle/0006_accounts.sql:2`), no `Math.random`.
- ✅ F-SAST-09 Debug mode in production (CWE-489): `apps/api/src/server.ts` only adds the router factory; `apps/api/src/app.ts` keeps `x-powered-by` disabled and helmet on; the error handler answers `{ code }` only.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): audit lines carry `requestId`, `userId` and `accountId` only (`apps/api/src/accounts/infrastructure/http/account-routes.ts:70-77`), asserted by a key-allowlist test; the error serializer drops query strings and driver `detail`.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface; body limit 16 kb (`apps/api/src/app.ts:121`).
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the origin guard is mounted globally before every router (`apps/api/src/app.ts:120`, `apps/api/src/shared/http/origin-guard.ts:15-20`) and requires the web origin and `X-Requested-With: argent` on POST, PATCH and DELETE, which covers every state-changing `/accounts` route; tests assert 403 without them.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` and `pnpm audit` — "No known vulnerabilities found"; no `package.json` or lockfile change in this ticket.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): every route goes through `validate` with shared schemas (`apps/api/src/accounts/infrastructure/http/account-routes.ts`); name trimmed, NFC and 1-50 code points, type and currency enums, `openingBalance` an int64 decimal string, `limit` 1-100, `offset` a non-negative integer, ids UUID, blank query values fail, `type` and `currency` on PATCH fail (`packages/shared/src/accounts/account.ts:21-60`), mirrored by CHECK constraints in the migration; two Info remarks (I-2, I-3).
- ✅ F-SAST-15 Insecure error handling (CWE-209): domain errors map to fixed codes from constraint names only, the driver message never reaches the client, unknown errors become 500 `{ code: 'INTERNAL' }` (`apps/api/src/shared/http/error-handler.ts`); one Low remark on availability (L-1).
- ✅ F-SAST-16 Medium CVE in a dependency: none (`pnpm audit` clean).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `exec`; the only dynamic `RegExp` is built from `Intl` separators passed through `escapeRegExp` and anchored (`packages/shared/src/money.ts:62-76`).
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Object-level authorization: every repository method applies `scopedTo(scope, { owner })` in the same statement as the row filter; `create` forces the owner from the scope; a foreign or missing id gives the same 404; `requireSession` and `requireVerifiedEmail` guard all routes (`apps/api/src/accounts/infrastructure/http/account-routes.ts:79`).
- Mass assignment: PATCH passes only `name`; the response is built field by field and stripped by the response schema, so `owner_id` and `updated_at` are never exposed.
- Migration: the trigger `accounts_immutable_fields` is not `SECURITY DEFINER` and uses no dynamic SQL; the rollback is destructive, documented, and applies before `0005_two_factor.down.sql`.
- Integer overflow: bigint sums throw `RangeError` instead of wrapping (see L-1).

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| L-1 | Low (CWE-190) | `apps/api/src/accounts/application/list-accounts.ts:55` | Each opening balance is valid up to the int64 limits (a human decision), so two accounts at the maximum overflow the per-currency total and the user's own list answers 500 `INTERNAL`; only that user is affected and single-account routes still work | Not fixed: a fix needs a product decision (an upper bound on the opening balance, or a typed 4xx error for overflow); raised to the human with the recommendation of a bound far below int64 (for example 10^15 minor units) in the PRD |
| I-2 | Info (CWE-1007) | `packages/shared/src/accounts/account.ts:21-30` | Account names accept control and bidirectional-control characters; React escapes them, so it is not XSS, but it becomes a spoofing vector once accounts are visible to other members | Accepted for now: self-owned data until PRD 05; follow-up to reject `\p{Cc}` and bidi controls |
| I-3 | Info (CWE-770) | `apps/api/src/accounts/infrastructure/http/account-routes.ts` | No per-user account cap and no accounts-specific write limiter | Accepted: human decision Q7 (2026-10-01), recorded as threat risk R-15 with review conditions |
| I-4 | Info (CWE-89 hygiene) | `apps/api/src/accounts/infrastructure/db/schema.ts:26` and `apps/api/test/accounts/account-repository.test.ts:268` | `sql.raw` and string-built SQL with constants or self-generated values | Accepted: not exploitable, the comment at `schema.ts:26` explains why |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 1 Low and 3 Info
documented, none blocking.
