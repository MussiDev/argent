# SAST report DISC-001-07a: Portfolios, Holdings and Manual Valuation

| Field | Value |
|-------|-------|
| Ticket | DISC-001-07a |
| Tier | FEATURE |
| Date | 2026-10-02 (re-scanned after the VERIFY corrective loop, commit `ffe5907`) |
| Scope | `git diff --ignore-cr-at-eol origin/main...HEAD`: `apps/api/src/investments/**` (domain, use cases, ports, Drizzle repositories, routes, serializers, module wiring), `apps/api/src/shared/http/error-handler.ts`, `apps/api/src/server.ts`, migration `apps/api/drizzle/0008_investments.sql` and its rollback, `packages/shared/src/investments/**`, `apps/web/src/features/investments/**`, `apps/web/src/lib/{api-client,format-amount}.ts`, the investments page, the authenticated shell link, the es/en catalogs; tests, fixtures and e2e read for secrets only |
| Method | Manual review by `ddw-sec-auditor` against catalog §4, plus `pnpm audit --prod --audit-level high` and `pnpm audit` (both: "No known vulnerabilities found"; this ticket adds no dependency) |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 4 Low and 5 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the only literals in tests and e2e are fixture values (`a-long-password-1`, `a long enough passphrase`, `not-a-jwt`, throwaway `@*.test` addresses); no key, DSN or token anywhere under `src`.
- ✅ F-SAST-02 SQL injection (CWE-89): every `sql` template binds its inputs as parameters (`apps/api/src/investments/infrastructure/db/drizzle-holding-repository.ts:109` `lower(${ticker})`, `:132` to `:157` the INSERT...SELECT that takes `owner_id` from the scoped portfolio row); no `sql.raw` on input (`sql.raw` appears only for compile-time constants in `schema.ts`); the migration `apps/api/drizzle/0008_investments.sql:1` is static DDL; a test stores `'; drop table holdings; --` as a portfolio name.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): every `BigInt(...)` of request data runs after the Zod regex and bounds (`apps/api/src/investments/infrastructure/http/holding-routes.ts:57`, `:95`, `packages/shared/src/investments/contracts.ts:18`); no `JSON.parse` of user data and no `eval`.
- ✅ F-SAST-05 Path traversal (CWE-22): ids are UUID params on the server (`packages/shared/src/investments/contracts.ts:84`) and `encodeURIComponent` on the client (`apps/web/src/lib/api-client.ts:365`); no filesystem access.
- ✅ F-SAST-06 XSS (CWE-79): no `dangerouslySetInnerHTML`, `innerHTML` or `document.write`; names and tickers are React text nodes (`apps/web/src/features/investments/components/holding-row.tsx:48`), tickers are limited to `[A-Za-z0-9][A-Za-z0-9._/-]*` (`packages/shared/src/investments/contracts.ts:41`).
- ✅ F-SAST-07 SSRF (CWE-918): the module makes no outbound requests; the web client talks only to the configured API origin (`apps/web/src/lib/api-client.ts:150`).
- ✅ F-SAST-08 Broken cryptography (CWE-327): no hashing or custom crypto; identifiers come from `gen_random_uuid()` (`apps/api/drizzle/0008_investments.sql:2`); no `Math.random`.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug switch; the error handler answers only `{ code, fields? }` (`apps/api/src/shared/http/error-handler.ts:107`).
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the audit lines carry only request id, user id, action and entity id (`apps/api/src/investments/infrastructure/http/portfolio-routes.ts:77`, `apps/api/src/investments/infrastructure/http/holding-routes.ts:62`); never names, quantities, costs or prices (tests assert it with sentinel values); `InvestmentRuleViolation` messages contain field names only (`apps/api/src/investments/domain/errors.ts:7`).
- ✅ F-SAST-11 Unrestricted upload (CWE-434): not applicable; no upload in this ticket.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the global origin guard (`apps/api/src/app.ts:120`, `apps/api/src/shared/http/origin-guard.ts:5`) covers every POST, PATCH, PUT and DELETE under `/investments`, on top of SameSite=Strict session cookies; the client sends `X-Requested-With` on every call (`apps/web/src/lib/api-client.ts:150`).
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` and `pnpm audit` report no known vulnerabilities; `package.json` and `pnpm-lock.yaml` are untouched by this ticket.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): every route runs the shared `validate` with Zod schemas for params, body and response (`apps/api/src/investments/infrastructure/http/holding-routes.ts:51`, `portfolio-routes.ts:44`); name 1 to 60, ticker 1 to 20, instrument name 1 to 100, quantity, cost and price bounded to 10^18, 10^15 and 10^12 (`packages/shared/src/investments/constants.ts:1`) and repeated as check constraints (`apps/api/drizzle/0008_investments.sql:16`); unknown keys are stripped, so `ownerId`, `portfolioId` and `source` never reach a use case; the price source is fixed to `manual` by the use case (`apps/api/src/investments/application/holding-use-cases.ts:121`).
- ✅ F-SAST-15 Insecure error handling (CWE-209): missing and foreign rows both answer the same 404 (`apps/api/src/shared/access/not-found-unless-allowed.ts:10`); validation lists paths only; `fields` is read only when it is an array of strings (`apps/api/src/shared/http/error-handler.ts:63`); a response that does not match its schema becomes 500 `INTERNAL`.
- ✅ F-SAST-16 Medium CVE in a dependency: none; `pnpm audit` is clean at every severity.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function`, `Math.random` or `localStorage` in the scope.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Authorization and data integrity review

Every repository method takes an `AccessScope` (writes `AccessScope<'write'>`) and puts `scopedTo` in the same statement (`apps/api/src/investments/infrastructure/db/drizzle-holding-repository.ts:56`, `apps/api/src/investments/infrastructure/db/drizzle-portfolio-repository.ts:15`); a miss answers 404, never 403. `requireSession` then `requireVerifiedEmail` are mounted once on `/investments` (`apps/api/src/investments/index.ts:47`) and the user id comes only from `auth`. Adding a holding locks the scoped portfolio row and inserts from that row, and the composite foreign key `holdings_portfolio_owner_fk` stops a cross-owner holding at the database (`apps/api/drizzle/0008_investments.sql:30`). The portfolio lock plus the unique `lower(ticker)` index prevent duplicate adds. Money and quantities are `bigint` columns and `BigInt` arithmetic, and the check constraints repeat the bounds. The rollback script header states that it destroys every portfolio and holding (`apps/api/drizzle/rollback/0008_investments.down.sql:1`).

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| L-1 | Low | `apps/api/src/investments/application/holding-use-cases.ts:43` | An add-merge locks the portfolio but reads the holding unlocked, while an edit locks only the holding, so a concurrent edit by the same user can be overwritten by the merge write (including a currency change reverted) | Deferred: own data only, no cross-user effect; to be handled with the next change to the use cases (lock the portfolio in the edit too) |
| L-2 | Low | `apps/api/src/investments/application/holding-use-cases.ts:110` | Setting a manual price is one UPDATE without a lock, so it can land after a concurrent currency edit cleared the price, leaving a price in the old currency; no database constraint ties the price to the currency | Deferred: same user only; fix together with L-1 by running the price update in the unit of work after `findForUpdate` |
| L-3 | Low | `apps/api/src/investments/index.ts:47` | No rate limit or per-user count cap on the investments routes | Accepted risk R-12 of the threat model (human decision, 2026-10-01); review conditions stated there |
| L-4 | Low | `apps/api/src/shared/http/error-handler.ts:63` | `fields` is read generically from any `AppError`; a future error placing value-bearing strings there would leak them | Deferred: today only field paths are placed there; convention recorded here and in the error handler tests |
| I-1 | Info | `apps/api/src/investments/domain/holding.ts:55` | A merge where either side has no total cost clears the cost | Human decision (PRD 07a FR-20), not a vulnerability |
| I-2 | Info | `packages/shared/src/investments/contracts.ts:38` | Names and tickers have no control or bidi character filter; React escaping makes it harmless, it could only mislead the owner of the data | Accepted |
| I-3 | Info | `packages/shared/src/investments/contracts.ts:38` | Length limits count UTF-16 units in Zod and code points in `char_length`; the database limit is never stricter than the Zod one | None |
| I-4 | Info | `apps/api/src/investments/infrastructure/http/holding-routes.ts:62` | Audit lines carry the user id and the entity id (opaque ids), consistent with the threat model | None |
| I-5 | Info | `apps/api/drizzle/0008_investments.sql:25` | The price-all-or-none and crypto-in-USD checks back up the application rules; the price-currency pairing of L-2 has no constraint | Tracked with L-2 |

## Re-scan after the VERIFY corrective loop

Delta reviewed: `git diff 7151fda..HEAD` for `apps/web/src/features/investments/**`
(`edit-holding-form.tsx`, `investments-screen.tsx`, `portfolio-card.tsx`,
`investments-container.tsx`), the es/en catalogs, the investments e2e selectors and tests. No
API, shared-package, migration, dependency or lockfile change. Pattern scan of the added lines found no
`dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `document.write`, storage access,
network call, secret or `console` use; the new DOM lookups (`closest('main')`, `querySelector('h1')`
in `investments-screen.tsx`, `data-opener` keys built from the constant prefixes `add-holding:` and
`delete-portfolio:` plus a server UUID in `portfolio-card.tsx`) match elements by comparing the
attribute value, never by interpolating data into a selector string, so there is no selector
injection; the heading receives `tabindex="-1"` only to take focus. The edit form no longer re-sends a
total cost expressed in another currency, which removes a data-integrity defect (not a
vulnerability). `pnpm audit --prod --audit-level high` and `pnpm audit`: "No known
vulnerabilities found". Result unchanged: 0 Critical, 0 High, 0 Medium; the Low and Info findings
above stand.

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 4 Low and 5 Info
documented, of which L-1, L-2 and L-4 are deferred and L-3 is the human-accepted risk R-12.
