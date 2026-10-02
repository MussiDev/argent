# Threat model DISC-001-03a: Exchange Rates, Store and Sync

| Field | Value |
|-------|-------|
| Ticket | DISC-001-03a |
| Spec | docs/ddw/specs/spec-DISC-001-03a.md |
| Tier | FEATURE |
| Date | 2026-10-02 |

Risk identifiers are local to this ticket (R-01 to R-12).

## Components
| Component | Source in the spec |
|---|---|
| `packages/shared/src/exchange-rates/scaled-rate.ts` + `packages/shared/src/exchange-rates/exchange-rate.ts` (decimal-text parser, response contract) | Block 1 |
| `apps/api/src/exchange-rates/domain/rate-quote.ts` + `apps/api/src/exchange-rates/application/refresh-rates.ts` + `apps/api/src/exchange-rates/application/get-latest-rates.ts` (completeness rule, refresh and read use cases) | Block 2 |
| `apps/api/src/exchange-rates/infrastructure/db/schema.ts` + `apps/api/drizzle/0012_exchange_rates.sql` (`exchange_rates`, `exchange_rate_sync`, `exchange_rate_refresh_failures`) + `apps/api/drizzle/rollback/0012_exchange_rates.down.sql` | Block 3 |
| `apps/api/src/exchange-rates/infrastructure/db/drizzle-rate-repository.ts` + `apps/api/src/exchange-rates/infrastructure/db/drizzle-refresh-schedule.ts` + `apps/api/src/exchange-rates/infrastructure/db/drizzle-refresh-failure-log.ts` | Block 3 |
| `apps/api/src/exchange-rates/infrastructure/provider/dolarapi-rate-provider.ts` + `apps/api/src/exchange-rates/infrastructure/provider/dolarapi-payload.ts` (HTTP client and payload mapping for dolarapi.com) | Block 4 |
| `apps/api/src/exchange-rates/infrastructure/provider/fake-rate-provider.ts` (canned quotes for tests and e2e) | Block 4 |
| `apps/api/src/exchange-rates/infrastructure/jobs/rates-sync-job.ts` + `apps/api/src/worker.ts` (polling job inside the worker process) | Block 5 |
| `apps/api/src/shared/config/env.ts` (`RATE_PROVIDER`, `DOLARAPI_BASE_URL` and their production rules) | Block 5 |
| `apps/api/src/exchange-rates/infrastructure/http/exchange-rate-routes.ts` (`GET /exchange-rates/latest`) + `apps/api/src/server.ts` wiring | Block 6 |

## Trust boundaries
- Worker process → dolarapi.com: the public internet, an external service we do not control; the rates and timestamps it answers are untrusted input, and our request carries no secret, cookie or user data.
- dolarapi.com response → `dolarapi-payload.ts` and `scaled-rate.ts`: raw bytes become typed bigint quotes only through strict parsing and the completeness rule.
- Worker process → PostgreSQL: private network; the rate rows, the schedule row and the failure records.
- Browser → API (Express): public internet; the session cookie goes up and the stored rates come down, over TLS.
- API routes → rates read use case: the authenticated session (`requireSession`, `requireVerifiedEmail`) crosses here; nothing about the caller selects the data.
- Deployment environment → `env.ts`: the operator's settings decide which provider and which base URL the worker uses.

## STRIDE analysis
### `packages/shared/src/exchange-rates/scaled-rate.ts` + `packages/shared/src/exchange-rates/exchange-rate.ts` (decimal-text parser, response contract)
- **Spoofing:** not applicable to pure functions; the contract carries no identity.
- **Tampering:** the parser accepts only plain decimal text, rejects exponents, signs, zero and values above 10,000,000.0000, and works on digit strings with bigint, so a crafted number cannot overflow or lose digits through a float (R-04).
- **Repudiation:** none; no side effects.
- **Information Disclosure:** the response schema lists only rate type, two scaled integers and two timestamps; undeclared fields are stripped.
- **Denial of Service:** the parser is linear in the length of the text, which the adapter has already capped by the 64 KiB body limit (R-03).
- **Elevation of Privilege:** nothing in the contracts grants access.

### `apps/api/src/exchange-rates/domain/rate-quote.ts` + `apps/api/src/exchange-rates/application/refresh-rates.ts` + `apps/api/src/exchange-rates/application/get-latest-rates.ts` (completeness rule, refresh and read use cases)
- **Spoofing:** the refresh runs only in the worker, which constructs the use case; the API process never builds a provider, so no request can trigger a fetch (R-08).
- **Tampering:** `assertCompleteQuotes` stores the 7 types or nothing: a missing, duplicate, zero or out-of-range quote fails the whole refresh and the stored rows stay as they were (R-02, R-09).
- **Repudiation:** every failed refresh writes a failure record with time and code, and every outcome is logged (R-10).
- **Information Disclosure:** the failure detail names a rate type, never provider text, so no third-party content reaches the database or the logs (R-07).
- **Denial of Service:** a failed refresh moves the schedule 5 minutes ahead, so a broken provider is not hammered in a tight loop (R-06).
- **Elevation of Privilege:** the read use case has no provider dependency and no write path, so the read side cannot be turned into a fetch or a write.

### `apps/api/src/exchange-rates/infrastructure/db/schema.ts` + `apps/api/drizzle/0012_exchange_rates.sql` (`exchange_rates`, `exchange_rate_sync`, `exchange_rate_refresh_failures`) + `apps/api/drizzle/rollback/0012_exchange_rates.down.sql`
- **Spoofing:** not applicable; the tables hold no identity and have no foreign key to `users`.
- **Tampering:** check constraints bound `rate_type` to the 7 values and each price to 1..100,000,000,000 scaled, `id = 1` makes the schedule a single row, and failure `code` is limited to the four codes; no float, real or numeric column exists (R-04, R-09).
- **Repudiation:** failure records carry `failed_at`, `code` and `status_code`, set by the application with the injected clock.
- **Information Disclosure:** the tables hold public market data and operational records only; no PII and no credentials (R-07).
- **Denial of Service:** the failure table is purged after 30 days by the job and indexed on `failed_at`, so it cannot grow without bound (R-06); the rate table has exactly 7 rows.
- **Elevation of Privilege:** the rollback script is destructive and is run by an operator with database access, never by the application; it says so in its header.

### `apps/api/src/exchange-rates/infrastructure/db/drizzle-rate-repository.ts` + `apps/api/src/exchange-rates/infrastructure/db/drizzle-refresh-schedule.ts` + `apps/api/src/exchange-rates/infrastructure/db/drizzle-refresh-failure-log.ts`
- **Spoofing:** not applicable; no user input reaches these repositories.
- **Tampering:** `replaceAll` is one `INSERT ... ON CONFLICT DO UPDATE` statement, so a reader never sees a mix of old and new rows (R-09); all values are bound parameters, never concatenated into SQL.
- **Repudiation:** schedule changes record `last_success_at` and `consecutive_failures`, and failures are recorded one row each.
- **Information Disclosure:** repositories return only the columns the use cases need.
- **Denial of Service:** `claim` is one atomic statement with a 5-minute lease, so many workers and many restarts cause at most one provider call per due time (R-05, R-06).
- **Elevation of Privilege:** the repositories have no user scope because the data is global; they are reachable only from the worker's job and from the read use case, which exposes no write.

### `apps/api/src/exchange-rates/infrastructure/provider/dolarapi-rate-provider.ts` + `apps/api/src/exchange-rates/infrastructure/provider/dolarapi-payload.ts` (HTTP client and payload mapping for dolarapi.com)
- **Spoofing:** the host is fixed by `DOLARAPI_BASE_URL`, pinned to `https://dolarapi.com` in production, and TLS authenticates the server; redirects are never followed (a 3xx answer counts as a bad status) so the request cannot be sent to another host (R-01).
- **Tampering:** a compromised or malicious provider (or a TLS-terminating attacker) could answer plausible but wrong numbers; the payload is bounded to 1..10,000,000, must be complete, and a wrong in-range rate is still possible, which is why a movement's rate is shown and editable before saving in DISC-001-03b (R-02).
- **Repudiation:** each fetch ends in a logged outcome and, on failure, a record with the HTTP status or the failure code (R-10).
- **Information Disclosure:** the request carries no cookie, token or user data; the response body is never logged or stored (R-07).
- **Denial of Service:** a 10-second timeout, a 64 KiB body cap read with a limit, a JSON content-type check and unfollowed redirects keep a slow or huge answer from tying up the worker (R-03).
- **Elevation of Privilege:** the response is parsed as data only (`JSON.parse` with a reviver that reads source text); nothing from it is evaluated, used as a path, a query or a command.

### `apps/api/src/exchange-rates/infrastructure/provider/fake-rate-provider.ts` (canned quotes for tests and e2e)
- **Spoofing:** a fake in production would serve invented rates as real ones; startup refuses `RATE_PROVIDER=fake` when `NODE_ENV=production` (R-11).
- **Tampering:** the fake returns fixed in-memory data and writes nothing outside the repository it is given.
- **Repudiation:** the job logs the same outcomes for the fake as for the real adapter.
- **Information Disclosure:** the fixture holds public sample rates only.
- **Denial of Service:** none; no I/O.
- **Elevation of Privilege:** none; the fake is selected only by environment, never by a request.

### `apps/api/src/exchange-rates/infrastructure/jobs/rates-sync-job.ts` + `apps/api/src/worker.ts` (polling job inside the worker process)
- **Spoofing:** the job takes no external input except the provider's quotes, which pass the completeness rule first.
- **Tampering:** a job crash mid-refresh leaves the old rows (the replace is one statement) and a lease that expires in 5 minutes, so the next pass retries (R-05, R-09).
- **Repudiation:** outcomes are logged with counts and codes only, and failure records persist in the database (R-10).
- **Information Disclosure:** logs carry the outcome, the failure code and the number of rate types, never provider text, prices or user data (R-07).
- **Denial of Service:** each job catches its own errors, so a rates failure cannot stop email delivery, and the poll is a single indexed statement every 30 seconds (R-06).
- **Elevation of Privilege:** the worker holds only the database credentials it already has and no new secret; the job adds no network listener.

### `apps/api/src/shared/config/env.ts` (`RATE_PROVIDER`, `DOLARAPI_BASE_URL` and their production rules)
- **Spoofing:** a wrong `DOLARAPI_BASE_URL` would point the worker at an attacker's host; in production the value must equal the default or startup fails (R-01).
- **Tampering:** an invalid value is rejected at startup, naming the variable and never the value.
- **Repudiation:** the validation error identifies which setting failed.
- **Information Disclosure:** neither setting is a secret; errors do not print values.
- **Denial of Service:** a bad setting stops the worker at boot instead of looping, and the API ignores both settings.
- **Elevation of Privilege:** `fake` is refused in production, so test data cannot be selected by a misconfigured deploy (R-11).

### `apps/api/src/exchange-rates/infrastructure/http/exchange-rate-routes.ts` (`GET /exchange-rates/latest`) + `apps/api/src/server.ts` wiring
- **Spoofing:** the route sits behind `requireSession` and `requireVerifiedEmail`; with no valid session it answers 401 and returns no rates (R-12).
- **Tampering:** read-only route; it accepts no body, query or params and changes nothing.
- **Repudiation:** the shared request log records route, status and request id for every call.
- **Information Disclosure:** the body holds public market data only; errors answer `{ code }` with no SQL or stack, and the response is typed by the shared schema.
- **Denial of Service:** the handler reads at most 7 rows by primary key and never calls the provider, so a flood of authenticated requests cannot reach the external service or load the database beyond a trivial query (R-08).
- **Elevation of Privilege:** there is no owner scope because the data is global; no answer depends on who asks, so there is nothing to escalate.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Exchange rates (buy, sell, provider and fetch timestamps) | public | PostgreSQL volume encrypted at rest; rows are market data | TLS to dolarapi.com; TLS from the API to the browser (production HTTPS guard) |
| Refresh schedule row and failure records (time, code, HTTP status, short detail) | public (operational, no PII) | PostgreSQL volume encrypted at rest | private database network |
| Session cookie and access token presented to `GET /exchange-rates/latest` | credentials | not stored by this module; the identity module stores them hashed | TLS, cookies flagged Secure in production |
| Provider response body | public | never stored or logged; only the mapped numbers are kept | TLS from dolarapi.com |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | The provider URL is changed or redirected so the worker talks to another host | S | L | H | In production `DOLARAPI_BASE_URL` must equal `https://dolarapi.com` or startup fails; redirects are never followed; requests carry no secret |
| R-02 | The provider (or a man in the middle) answers plausible but wrong rates | T | L | H | HTTPS to a pinned host, hard bounds of 1..10,000,000, a complete set of 7 or nothing, both timestamps returned so callers can judge age, and the rate on a movement is shown and editable before it is saved (DISC-001-03b FR-05); a jump guard against the previous value is not in the PRD and is raised as an open question instead of being invented |
| R-03 | An oversized or slow answer ties up the worker | D | M | M | 10-second timeout, 64 KiB body cap read with a limit, JSON content-type check, redirects never followed |
| R-04 | A rate loses precision or overflows through a float | T | M | H | JSON number source text goes to a bigint parser (no `Number`), bigint columns with range checks, a static no-float test and a schema-introspection test |
| R-05 | Several workers or a restart refresh at the same time and hit the provider more than needed | D | M | L | Atomic one-statement claim with a 5-minute lease in `exchange_rate_sync`; a test with two concurrent jobs asserts one provider call |
| R-06 | A failing provider is hammered, or the failure table grows without bound | D | M | M | A failure retries after 5 minutes at the earliest; failure records are purged after 30 days and indexed on `failed_at` |
| R-07 | Provider content or prices leak into logs or the database through error handling | I | L | M | Failure detail names a rate type only and is at most 200 characters; bodies are never logged or stored; logs carry outcome codes and counts |
| R-08 | A user request triggers a provider call or floods the database | D | L | M | The API process never constructs a provider; the read path has no provider dependency (source-scan test and spy test); the read is 7 rows by primary key behind session and verified-email gates |
| R-09 | A half-written or inconsistent set of rates is served | T | L | H | One-statement upsert of all 7 rows, completeness checked before any write, check constraints on every column |
| R-10 | A refresh failure goes unnoticed | R | M | M | Each failure writes a record and a log line with code and status; `consecutive_failures` is kept on the schedule row |
| R-11 | The fake provider is active in production | S | L | H | `RATE_PROVIDER=fake` is rejected when `NODE_ENV=production`, tested in the environment tests |
| R-12 | Rates are read without a session | S | L | L | `requireSession` and `requireVerifiedEmail` on the prefix; AC-04 test asserts 401 and an empty body |

## Supply chain
No new dependency: the adapter uses the global `fetch` of Node 24, the job uses timers from the platform, and persistence uses the already-installed `drizzle-orm` and `pg`. The only third party is the dolarapi.com service, which sits behind a single `RateProvider` port with one adapter and a fake, so it can be replaced without touching the use cases or the movements that will read the stored rates. Tests never reach it: they use the fake, a recorded fixture and a local stub server.

## Availability
The provider being down is the expected failure: the last stored rates keep being served, each failure is recorded, and the retry is 5 minutes later (R-06, R-10). The refresh runs only in the worker, so an API replica count change cannot multiply provider calls, and a rates failure cannot stop email delivery because each job catches its own errors. The read endpoint touches 7 rows and has no external dependency, so it stays up when the provider is down.
