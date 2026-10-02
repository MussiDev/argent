# SAST report DISC-001-02b: Categories

| Field | Value |
|---|---|
| Ticket | DISC-001-02b |
| Tier | FEATURE |
| Date | 2026-10-02 |
| Scope | `git diff --ignore-cr-at-eol origin/main...HEAD` without `docs/`: `packages/shared/src/categories/**`, `apps/api/src/categories/**`, identity provisioning port, hook, unit of work, `register-user.ts`, `complete-google-sign-in.ts`, `apps/api/drizzle/0009_categories.sql` with snapshot and rollback, `apps/api/src/server.ts`, `app.ts`, `error-handler.ts`, `apps/web/src/features/categories/**`, the categories page, `api-client.ts`, catalogs, `globals.css`, `eslint.config.mjs`; tests and e2e for secrets only |
| Method | Manual review by `ddw-sec-auditor`, plus `pnpm audit --prod --audit-level high` and `pnpm audit` run by the orchestrator on the final tree |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 2 Low and 2 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): none in `apps/api/src/categories`, `apps/web/src/features/categories` or `apps/web/e2e/categories.spec.ts`; test passphrases never reach `src`.
- ✅ F-SAST-02 SQL injection (CWE-89): `apps/api/src/categories/infrastructure/db/seed-default-categories.ts:13` binds every value through `sql` placeholders; the advisory lock key at `apps/api/src/categories/infrastructure/db/drizzle-category-repository.ts:215` is a bound parameter; `apps/api/drizzle/0009_categories.sql:41` (backfill) and `:95` (guard function) are static DDL with no input.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): input is parsed only by `express.json` (`apps/api/src/app.ts:124`, size limited) and the shared Zod schemas.
- ✅ F-SAST-05 Path traversal (CWE-22): no file I/O in the scope; the web client guards the ids `''`, `.` and `..` (`apps/web/src/lib/api-client.ts`) and the server requires a UUID.
- ✅ F-SAST-06 XSS (CWE-79): no `dangerouslySetInnerHTML` or `innerHTML` under `apps/web/src/features/categories`; names render as React text nodes and refuse control and format characters (`packages/shared/src/categories/category.ts:60`).
- ✅ F-SAST-07 SSRF (CWE-918): no server-side outbound request; the web client calls its own fixed base URL (`apps/web/src/lib/api-client.ts:224`).
- ✅ F-SAST-08 Broken cryptography (CWE-327): no crypto in the module; `hashtextextended` in the advisory lock is not a security control.
- ✅ F-SAST-09 Debug mode in production (CWE-489): the error handler answers `{ code }` only (`apps/api/src/shared/http/error-handler.ts:88`).
- ✅ F-SAST-10 Logging sensitive data (CWE-532): audit lines carry `requestId`, `userId` and `categoryId` only (`apps/api/src/categories/infrastructure/http/category-routes.ts:71`), asserted by a key-allowlist test; `NewUserProvisioningFailed` has a fixed message and the logger omits bound query parameters (`apps/api/src/shared/logging/logger.ts:93`).
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface; body limit 16 kb (`apps/api/src/app.ts:124`).
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the origin guard is mounted globally before every router (`apps/api/src/app.ts:123`) and requires the web origin and `X-Requested-With` on POST, PATCH and DELETE, covering `/archive` and `/unarchive`.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` and `pnpm audit` — "No known vulnerabilities found"; no runtime dependency added.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): every route validates params, query and body with shared schemas (`apps/api/src/categories/infrastructure/http/category-routes.ts:85`); PATCH declares `kind` and `parentId` as `z.never()` (`packages/shared/src/categories/category.ts:100`) so mass assignment fails, and database CHECKs mirror the name length (`apps/api/drizzle/0009_categories.sql:15`).
- ✅ F-SAST-15 Insecure error handling (CWE-209): domain errors map to fixed codes, a foreign-key violation on delete becomes `CategoryInUse` (`apps/api/src/categories/infrastructure/db/drizzle-category-repository.ts:201`), anything else is a generic 500 `{ code: 'INTERNAL' }`.
- ✅ F-SAST-16 Medium CVE in a dependency: none (`pnpm audit` clean).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `exec` in the scope.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Object-level authorization: every repository read and write goes through `scopedRow(scope, id)` or `inScope(scope)` in the same statement (`apps/api/src/categories/infrastructure/db/drizzle-category-repository.ts:34`); insert takes the owner from the scope (`:87`); a foreign id answers the same 404 as a missing one, asserted by route tests.
- Database guard: trigger `categories_guard` makes owner, kind, parent and default key immutable and blocks nesting deeper than one level (`apps/api/drizzle/0009_categories.sql:99`); the composite foreign key on id, owner and kind blocks cross-owner and cross-kind parents.
- Races: the per-owner advisory lock serializes name checks; the unique index on owner and default key and the marker `on conflict do nothing` keep seeding idempotent.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| L-1 | Low (CWE-770) | `apps/api/src/categories/infrastructure/http/category-routes.ts:85` | No per-user category cap and no categories-specific write limiter | Accepted: same decision as accounts (Q7), recorded in the threat model availability section |
| L-2 | Low (CWE-400) | `apps/api/src/categories/infrastructure/db/drizzle-category-repository.ts:113` | The safety-net `ensureDefaults` adds one indexed select per request | Accepted: human decision D9 keeps it; cost is one marker lookup |
| I-3 | Info (CWE-400) | `apps/api/src/identity/application/register-user.ts:80` | Seeding adds one bounded statement (33 rows) inside sign-up; the 0009 backfill scales once with users at deploy | Accepted: threat risk R-15 and R-16; perf budgets pass with seeding |
| I-4 | Info | `apps/api/src/categories/infrastructure/http/category-routes.ts:47` | Read routes request a write scope because `ensureDefaults` may seed | Accepted: by design (D9) |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 2 Low and 2 Info
documented, none blocking.
