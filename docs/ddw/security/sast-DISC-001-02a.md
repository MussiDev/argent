# SAST report DISC-001-02a: Accounts

| Field | Value |
|---|---|
| Ticket | DISC-001-02a |
| Tier | FEATURE |
| Date | 2026-10-01 |
| Scope | `git diff --ignore-cr-at-eol origin/main...HEAD` without `docs/`, in two passes: the full scope of the ticket (`packages/shared/src/money.ts`, `accounts/account.ts`, `errors.ts`; `apps/api/src/accounts/**`, `apps/api/src/shared/db/pg-errors.ts`, identity `unique-violation.ts`, `apps/api/src/server.ts`, `error-handler.ts`; migration `0006_accounts` with its rollback, snapshot and journal; `apps/web/src/features/accounts/**`, `components/ui/select.tsx`, the accounts pages, `api-client.ts`, catalogs; tests, e2e and perf files for secrets only), and the delta `fa8dfaf..HEAD` of the corrective loop for the human decisions L-1 and I-2 (opening balance bound, exact balances and totals, control and format characters in names, regenerated unmerged migration with a CHECK constraint, web messages) |
| Method | Manual review by `ddw-sec-auditor` against catalog §4 (twice), plus `pnpm audit --prod --audit-level high` and `pnpm audit` run by the orchestrator on the final tree |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; the earlier Low L-1 and Info I-2 are resolved; 4 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the diff holds no keys or tokens; the only credentials are test fixtures (`apps/api/test/accounts/account-routes.test.ts` passphrase constant and the passphrase in `apps/web/e2e/accounts.spec.ts`), which never reach `src`.
- ✅ F-SAST-02 SQL injection (CWE-89): the repository uses Drizzle builders and parameter-bound `sql` fragments only (`apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts:86-95`); `sql.raw(literals)` in `apps/api/src/accounts/infrastructure/db/schema.ts:26` receives compile-time constants with quotes escaped; the CHECK on the opening balance is a fixed `sql` template (`schema.ts:48-52`); the regenerated migration and rollback are static DDL (`apps/api/drizzle/0006_accounts.sql:12`, `apps/api/drizzle/rollback/0006_accounts.down.sql:15`); the test seed with `generate_series` binds its parameters (`apps/api/test/accounts/account-routes.test.ts:429-434`). Test-only string-built SQL (`apps/api/test/accounts/account-repository.test.ts:268`) interpolates test constants — see I-4.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the diff.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): input is parsed by `express.json` and the shared Zod schemas through `validate`; `BigInt(body.openingBalance)` (`apps/api/src/accounts/infrastructure/http/account-routes.ts:92`) only receives a string already checked against the integer pattern, the int64 range and the 10^15 bound (`packages/shared/src/money.ts:6-17`, `packages/shared/src/accounts/account.ts:21-34`).
- ✅ F-SAST-05 Path traversal (CWE-22): the API does no file I/O in this scope; the web client rejects the ids `''`, `.` and `..` and encodes the rest (`apps/web/src/lib/api-client.ts` `accountPath`), and the server requires a UUID (`packages/shared/src/accounts/account.ts`).
- ✅ F-SAST-06 XSS (CWE-79): no `dangerouslySetInnerHTML`, `innerHTML` or `eval` under `apps/web/src`; account names render only as React text nodes (`apps/web/src/features/accounts/components/account-list.tsx:77,159,184`) and now also refuse control and format characters (`packages/shared/src/accounts/account.ts:44-55`); the interpolated limit in the out-of-range message is a `formatMoney` string over a constant (`apps/web/src/features/accounts/components/account-field.tsx:57`).
- ✅ F-SAST-07 SSRF (CWE-918): no server-side outbound request was added; the web client uses a fixed base URL plus an encoded UUID segment.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no crypto in this module; ids come from `gen_random_uuid()` (`apps/api/drizzle/0006_accounts.sql:2`), no `Math.random`.
- ✅ F-SAST-09 Debug mode in production (CWE-489): `apps/api/src/server.ts` only adds the router factory; `apps/api/src/app.ts` keeps `x-powered-by` disabled and helmet on; the error handler answers `{ code }` only.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): audit lines carry `requestId`, `userId` and `accountId` only (`apps/api/src/accounts/infrastructure/http/account-routes.ts:70-77`), asserted by a key-allowlist test and unchanged by the corrective loop.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface; body limit 16 kb (`apps/api/src/app.ts:121`).
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the origin guard is mounted globally before every router (`apps/api/src/app.ts:120`, `apps/api/src/shared/http/origin-guard.ts:15-20`) and requires the web origin and `X-Requested-With: argent` on POST, PATCH and DELETE, which covers every state-changing `/accounts` route; tests assert 403 without them.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` and `pnpm audit` on the final tree — "No known vulnerabilities found"; no `package.json` or lockfile change in this ticket.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): every route goes through `validate` with shared schemas (`apps/api/src/accounts/infrastructure/http/account-routes.ts`); the opening balance is an int64 decimal string bounded to plus or minus 10^15 minor units by a pipe that never runs the bound on text that failed the pattern (`packages/shared/src/accounts/account.ts:24-34`), mirrored by the CHECK `accounts_opening_balance_range_check` (`apps/api/src/accounts/infrastructure/db/schema.ts:48-52`); names are NFC, 1-50 code points and refuse Cc and Cf characters before trimming in a linear transform with no ReDoS (`packages/shared/src/accounts/account.ts:44-60`), capped by the 16 kb body limit; `limit` 1-100, `offset` non-negative, ids UUID; the exact response schema is anchored with at most 40 digits (`packages/shared/src/money.ts:20`); one Info remark (I-5).
- ✅ F-SAST-15 Insecure error handling (CWE-209): domain errors map to fixed codes from constraint names only, the driver message never reaches the client, unknown errors become 500 `{ code: 'INTERNAL' }` (`apps/api/src/shared/http/error-handler.ts`); the overflow paths that could answer 500 are gone because balances and totals use exact arithmetic (`apps/api/src/accounts/domain/account.ts:21`, `apps/api/src/accounts/application/list-accounts.ts:55`), and a bypassed CHECK (23514) would only produce a generic 500 `{ code }`.
- ✅ F-SAST-16 Medium CVE in a dependency: none (`pnpm audit` clean).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `exec`; the dynamic `RegExp` in `parseAmountInput` is built from `Intl` separators passed through `escapeRegExp` and anchored (`packages/shared/src/money.ts`), and the new name regexes are static literals.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Object-level authorization: every repository method applies `scopedTo(scope, { owner })` in the same statement as the row filter; `create` forces the owner from the scope; a foreign or missing id gives the same 404; `requireSession` and `requireVerifiedEmail` guard all routes (`apps/api/src/accounts/infrastructure/http/account-routes.ts:79`).
- Mass assignment: PATCH passes only `name`; the response is built field by field and stripped by the response schema, so `owner_id` and `updated_at` are never exposed.
- Migration: the trigger `accounts_immutable_fields` is not `SECURITY DEFINER` and uses no dynamic SQL; the rollback is destructive, documented, and applies before `0005_two_factor.down.sql`; the unmerged 0006 was regenerated in place, so only throwaway databases that applied the earlier 0006 need dropping.
- Overflow: stored opening balances stay int64 and bounded; balances and totals are exact `bigint` values serialized as integer strings of at most 40 digits (the worst case is far below that), so no sum can fail.

## Resolved since the first pass

| ID | Was | Resolution |
|---|---|---|
| L-1 | Low (CWE-190): two accounts at the int64 maximum overflowed the per-currency total and the list answered 500 | Human decision 2026-10-01: opening balance bounded to 10^15 minor units in the shared schema and the database, exact derived arithmetic, covered by a 9,300-account route test (`apps/api/test/accounts/account-routes.test.ts:427-440`) |
| I-2 | Info (CWE-1007): names accepted control and bidirectional-control characters | Human decision 2026-10-01: names refuse Unicode Cc and Cf characters (`packages/shared/src/accounts/account.ts:44-55`) with tests for zero-width, right-to-left override, NUL, soft hyphen, byte order mark, tab and newline |

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-3 | Info (CWE-770) | `apps/api/src/accounts/infrastructure/http/account-routes.ts` | No per-user account cap and no accounts-specific write limiter | Accepted: human decision Q7 (2026-10-01), recorded as threat risk R-15 with review conditions |
| I-4 | Info (CWE-89 hygiene) | `apps/api/src/accounts/infrastructure/db/schema.ts:26` and `apps/api/test/accounts/account-repository.test.ts:268` | `sql.raw` and string-built SQL with constants or self-generated values | Accepted: not exploitable, the comment at `schema.ts:26` explains why |
| I-5 | Info (CWE-1007) | `packages/shared/src/accounts/account.ts:44-55` | Non-control Unicode spaces (U+00A0, U+3000, U+2028 and similar) and visually blank characters outside Cc and Cf (U+3164, U+2800) remain allowed in names, and the case-insensitive uniqueness does not collapse them | Accepted: matches the human decision scope (Cc and Cf); self-owned data until PRD 05, where compatibility-normalized uniqueness can be revisited |
| I-6 | Info (CWE-755) | `apps/web/src/features/accounts/components/account-list.tsx:117` | `money()` throws in render if the API ever sends a malformed amount | Accepted: the API validates its responses, so it is not user-reachable |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); the earlier Low
(L-1) and Info (I-2) are resolved; 4 Info documented, none blocking.
