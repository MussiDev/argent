# SAST report DISC-001-03b: Expense and Income

| Field | Value |
|---|---|
| Ticket | DISC-001-03b |
| Tier | FEATURE |
| Date | 2026-10-02 |
| Scope | `git diff origin/main...HEAD` over `apps/` and `packages/` without tests and e2e (60 source files): `packages/shared/src/movements/**`, `packages/shared/src/time/zoned-time.ts`, `errors.ts`; `apps/api/src/movements/**` (domain, application, Drizzle repository, lookups, adapters, limiter, erasure step, routes, presenter, barrel); `apps/api/src/{app,server}.ts`, `shared/http/error-handler.ts`, identity user-deletion repository and step type, accounts schema; migration `0014_movements` with its rollback, snapshot and journal; `eslint.config.mjs`; `apps/web/src/features/movements/**`, `apps/web/src/lib/api-client.ts`, the movement pages and the authenticated shell, catalogs; tests, fixtures and e2e scanned for secrets only |
| Method | Manual review of the diff by the orchestrator against catalog §4, targeted searches over the scope (secrets, raw SQL, dangerous functions, outbound calls, logging, HTML sinks, file access, cryptography), the threat model R-01 to R-18 as checklist, plus `pnpm audit --prod --audit-level high` on the final tree |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 4 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the secret-pattern search over the 60 source files returns nothing; the test database URLs appear only in test and e2e support with the existing local credentials; no `.env` change.
- ✅ F-SAST-02 SQL injection (CWE-89): every statement is a Drizzle builder or a `sql` template whose interpolations are columns or bound parameters (`apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts:52`, `drizzle-movement-write-limiter.ts:46,58`, `drizzle-account-movements.ts:23` where ids go through `inArray` bound parameters in chunks of 500); the only `sql.raw` calls take compile-time constants for check constraints (`apps/api/src/movements/infrastructure/db/schema.ts:31,37,38,85`, `apps/api/src/accounts/infrastructure/db/schema.ts:26`, quoting escaped, never from input); migration 0014 and its rollback are static DDL.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope (the two `exec` hits are `RegExp.exec` in `packages/shared/src/movements/rate-input.ts:49` and `packages/shared/src/time/zoned-time.ts:67`, static patterns).
- ✅ F-SAST-04 Insecure deserialization (CWE-502): request bodies are parsed by Express JSON and validated by shared Zod schemas (`apps/api/src/movements/infrastructure/http/movement-routes.ts:134`); no custom deserialization.
- ✅ F-SAST-05 Path traversal (CWE-22): no file access in `src` (the search for `readFile`, `writeFile`, `path.join` in the scope finds none).
- ✅ F-SAST-06 XSS (CWE-79): the web code renders through React text nodes; no `dangerouslySetInnerHTML`, `innerHTML` or `document.write` in the scope; user text (the note, names) is only rendered as text.
- ✅ F-SAST-07 SSRF (CWE-918): no outbound request is added on the API; the only call in the web client builds `${baseUrl}${path}` from the configured API base and fixed paths (`apps/web/src/lib/api-client.ts:299`); a movement id in a path is validated as a UUID by `movementIdParamsSchema`.
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography added; ids come from the database, no `Math.random` or hashing in the scope.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag added; the only `NODE_ENV` use in the diff is the existing test-only hook guard in `apps/api/src/app.ts:61,146`.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the audit line carries request id, user id and movement id only (`apps/api/src/movements/infrastructure/http/movement-routes.ts:112`), tested to exclude amount, note and rate; the error handler logs method, route without query, status and code (`apps/api/src/shared/http/error-handler.ts:111`); no `console` in the web code; one Info remark (I-1).
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): `POST /movements` sits behind `requireSession`, `requireVerifiedEmail` and the global origin guard (`apps/api/src/movements/infrastructure/http/movement-routes.ts:130`, tested: a state-changing request without the web origin headers is refused); CORS keeps the explicit origin with `credentials` and only adds `exposedHeaders: ['Retry-After']` (`apps/api/src/app.ts:123`).
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` on the final tree — "No known vulnerabilities found"; no `package.json` or lockfile change in this ticket.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): params, query and body are validated by shared schemas through the one `validate` middleware (amount 1 to 10^15, note at most 500, rate scaled 1 to 10^11 with a source, occurred-at as an instant, page at most 100); responses are parsed by the response schema; ownership of account and category is checked in the same statement as the lookup (`drizzle-account-lookup.ts`, `drizzle-category-lookup.ts`); database check constraints mirror the ranges (`apps/api/src/movements/infrastructure/db/schema.ts`); client-sent owner, id, timestamps and rate type are stripped (tested, threat R-16).
- ✅ F-SAST-15 Insecure error handling (CWE-209): errors map to `{ code }` bodies through the one error middleware, a database failure answers 500 `{ code: 'INTERNAL' }` (exact-equality test), the 429 carries only `Retry-After` (`apps/api/src/shared/http/error-handler.ts:115`); foreign movement, account and category ids answer 404 identical to missing ones.
- ✅ F-SAST-16 Medium CVE in a dependency: none (`pnpm audit` clean).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `exec` in the scope; regular expressions are static literals (`rate-input.ts:49`, `zoned-time.ts:67`, the web error code mapping) with no nested quantifiers.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Authorization and data scope: every movement query is scoped by owner in the same statement; the two cross-module adapters (`createAccountMovements`, `createCategoryUsage`) are unscoped by design, receive only ids that the caller already authorized, and return data keyed by those ids (threat R-13, tested with another user's rows).
- Abuse and availability: manual creation is limited to 60 per minute per user by a stateless, database-backed counter with an atomic upsert (`drizzle-movement-write-limiter.ts:30-52`), 429 with `Retry-After`, no creation counted on a 4xx (threat R-01, R-08); list pages are capped at 100.
- Integrity: composite foreign keys keep an account and category owned by the movement's owner and the category kind equal to the movement type, `ON DELETE RESTRICT`; user erasure runs an ordered step after locking the user row, inside the existing transaction (threat R-10, R-11).
- Money and time: amounts are `bigint`, rates scaled integers; a scan test forbids float constructs in the module, the shared movement code and the web rate formatter; the date rule uses the user's time zone and rejects a skipped local hour.
- Migration: `0014_movements` creates two tables, one unique constraint on accounts, composite keys and indexes; no seed, trigger or dynamic SQL; its rollback is documented and applies before older rollbacks; the journal `when` 1790966184307 is greater than 0013's 1790962588595.
- Supply chain: no new dependency.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info (CWE-532) | `apps/api/src/movements/infrastructure/http/movement-routes.ts:81` | A limiter release failure logs the raw error object (`{ err: error }`); a driver error can carry statement text | Accepted: the statement only touches the `movement_rate_limits` counters (no amount, note or name), the logger redacts sensitive keys, and the same pattern exists in the error handler |
| I-2 | Info (CWE-400) | `apps/api/src/movements/infrastructure/db/drizzle-movement-write-limiter.ts:33-40` | An instance with a lagging clock can re-insert an already deleted older window row | Accepted: one stale counter row at most, removed by the next newer call, it cannot reach the limit alone |
| I-3 | Info (CWE-362) | `apps/api/src/identity/infrastructure/db/drizzle-user-deletion-repository.ts:82` | A user erasure can lose a deadlock (40P01) against the same user deleting an account or category at that instant | Accepted: needs two simultaneous actions by one user, PostgreSQL aborts one, and the erasure is retryable |
| I-4 | Info (CWE-841) | `apps/web/src/features/movements/containers/create-movement-container.tsx` | The create request has no idempotency key: a lost response followed by a retry can create a duplicate movement | Accepted: the limiter and the list make a duplicate visible and deletable later; to be confirmed by the project owner as a known limitation |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 4 Info
documented, none blocking.
No known vulnerabilities found
