# SAST report DISC-001-03a: Exchange Rates, Store and Sync

| Field | Value |
|---|---|
| Ticket | DISC-001-03a |
| Tier | FEATURE |
| Date | 2026-10-02 |
| Scope | `git diff --ignore-cr-at-eol origin/main...HEAD` without `docs/`: `packages/shared/src/exchange-rates/**`, `packages/shared/src/index.ts`, `rate-types.ts`; `apps/api/src/exchange-rates/**` (domain, application ports and use cases, Drizzle repositories and schema, the dolarapi adapter, the fake provider, the sync job, the HTTP route and presenter, the barrel, the system clock); `apps/api/src/worker.ts`, `server.ts`, `shared/config/env.ts`; migration `0012_exchange_rates` with its rollback, snapshot and journal; `.env.example`, `playwright.config.ts`; tests and fixtures for secrets only |
| Method | Manual review of the diff by the orchestrator against catalog §4, with targeted searches over the scope (dangerous functions, raw SQL, outbound calls, logging, secrets), the threat model R-01 to R-12 as checklist, plus `pnpm audit --prod --audit-level high` and `pnpm audit` on the final tree |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 3 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the diff holds no keys, tokens or credentials; the only URL constants are the public `https://dolarapi.com` default (`apps/api/src/shared/config/env.ts:46`) and the test database URL in test helpers; `.env*` is ignored (`.gitignore:12`) and `.env.example` documents the two new settings without secrets.
- ✅ F-SAST-02 SQL injection (CWE-89): repositories use Drizzle builders and bound parameters only (`apps/api/src/exchange-rates/infrastructure/db/drizzle-rate-repository.ts:16-22`, `drizzle-refresh-schedule.ts:21,46`); the only `sql.raw` calls receive compile-time constants (`apps/api/src/exchange-rates/infrastructure/db/schema.ts:23` for the fixed lists of rate types and failure codes, `schema.ts:37` for `RATE_MAX_SCALED.toString()`); migration 0012 and its rollback are static DDL.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): the only parsed external data is the provider's JSON, read with `JSON.parse` plus a reviver that wraps number source text and evaluates nothing (`apps/api/src/exchange-rates/infrastructure/provider/dolarapi-payload.ts`); a key such as `__proto__` becomes an own data property; the payload is validated field by field before use.
- ✅ F-SAST-05 Path traversal (CWE-22): no file I/O in `src`; the provider path is the constant `/v1/dolares` appended to a validated base URL (`apps/api/src/exchange-rates/infrastructure/provider/dolarapi-rate-provider.ts:62`).
- ✅ F-SAST-06 XSS (CWE-79): no web code and no HTML output in this ticket; the route answers JSON typed by the shared response schema.
- ✅ F-SAST-07 SSRF (CWE-918): the only outbound request goes to `DOLARAPI_BASE_URL`, which production pins to exactly `https://dolarapi.com` (`apps/api/src/shared/config/env.ts:132-134`, tested), uses `redirect: 'manual'` so a 3xx is never followed (`dolarapi-rate-provider.ts:63`), carries no cookie, token or user data, and never runs in a request path (the API process imports only the HTTP module, enforced by `apps/api/test/exchange-rates/request-path.test.ts`).
- ✅ F-SAST-08 Broken cryptography (CWE-327): no cryptography in this scope; ids come from `gen_random_uuid()` in the failure table, no `Math.random`.
- ✅ F-SAST-09 Debug mode in production (CWE-489): `RATE_PROVIDER=fake` is rejected in production (`env.ts:128-130`, tested); no debug flags were added.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): the job logs outcome strings, the failure code and a purge count only (`apps/api/src/exchange-rates/infrastructure/jobs/rates-sync-job.ts:42,44,58,82,84`); provider bodies and prices are never logged or stored, and `detail` names a rate type or a fixed phrase at most 200 characters (truncated in `drizzle-refresh-failure-log.ts`); the error object logged at `:58,:84` goes through the existing logger redaction; one Info remark (I-1).
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface; the provider body is capped at 65,536 bytes while streaming (`dolarapi-rate-provider.ts:6,23-45`).
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): the only route added is a read-only `GET /exchange-rates/latest` behind `requireSession` and `requireVerifiedEmail` (`apps/api/src/exchange-rates/infrastructure/http/exchange-rate-routes.ts:21`); it changes no state, so the global origin guard has nothing to protect here.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` on the final tree — "No known vulnerabilities found"; no `package.json` or lockfile change in this ticket (the adapter uses the global `fetch` of Node 24).
- ✅ F-SAST-14 Incomplete input validation (CWE-20): the route declares an empty query schema and a typed response (`exchange-rate-routes.ts:23-31`); the untrusted provider payload is validated for status, content type, size, top-level shape, `moneda`, `casa`, price text (`parseScaledRate`: plain decimal, positive, at most 10,000,000.0000), strict ISO date and completeness of the 7 types (`dolarapi-payload.ts`, `apps/api/src/exchange-rates/domain/rate-quote.ts`); database check constraints mirror the ranges (`schema.ts:50-52`); environment values are validated by Zod (`env.ts:63-64`).
- ✅ F-SAST-15 Insecure error handling (CWE-209): a database failure on the route becomes 500 `{ code: 'INTERNAL' }` through the shared handler (asserted by an exact-equality test in `apps/api/test/exchange-rates/exchange-rate-routes.test.ts`); provider failures are typed `RateProviderFailure` values that never reach HTTP.
- ✅ F-SAST-16 Medium CVE in a dependency: none (`pnpm audit` clean).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `exec`; the only regular expressions are static literals (rate text, ISO date, content type) with no nested quantifiers.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Authorization: the data is global market data, so there is no owner scope; the route requires a verified session, and nothing in a response depends on who asks (threat R-12).
- Concurrency and integrity: `replaceAll` is one upsert statement and `claim` is one atomic statement with a lease; `succeeded` and `failed` are guarded by the lease value (threat R-05, R-09).
- Migration: `0012_exchange_rates` creates three tables with checks and one index, no seed, no trigger, no dynamic SQL; its rollback is destructive, documented, and applies before the rollback of any older migration; the journal `when` is greater than every other entry on `main` and on the open branches.
- Supply chain: no new dependency; the only third party is dolarapi.com behind one port with a fake.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info (CWE-532) | `apps/api/src/exchange-rates/infrastructure/jobs/rates-sync-job.ts:58` | A storage error object is logged whole (`{ err: error }`); a driver error can carry statement text or row values | Accepted: the data is public market data, the logger redacts sensitive keys, and the identical pattern already exists in the email worker |
| I-2 | Info (CWE-345) | `apps/api/src/exchange-rates/infrastructure/provider/dolarapi-payload.ts` | A wrong but in-range rate from the provider cannot be detected (no jump guard) | Accepted: threat R-02, accepted by the project owner on 2026-10-02 (human decision relayed by the orchestrator), review conditions in the threat model |
| I-3 | Info (CWE-400) | `apps/api/src/exchange-rates/application/refresh-rates.ts:36-39` | `replaceAll` is not guarded by the lease: a refresh that outlives its 5-minute lease could overwrite fresher rates | Accepted: the provider timeout is 10 seconds, far below the lease, and the effect would be one slightly older set of public rates until the next refresh |

## Summary

Total: 19 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 3 Info
documented, none blocking.
No known vulnerabilities found
