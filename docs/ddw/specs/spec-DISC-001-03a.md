# Spec DISC-001-03a: Exchange Rates, Store and Sync

| Field | Value |
|-------|-------|
| Ticket | DISC-001-03a |
| PRD | docs/ddw/prd/prd-DISC-001-03a.md |
| Tier | FEATURE |
| Date | 2026-10-02 |
| Spec loops | 2 |
| Loops since last human decision | 0 |

## Summary
A new module `apps/api/src/exchange-rates/` (hexagonal, mirroring `accounts`) keeps one current row per
rate type (7 rows) in PostgreSQL. A refresh use case asks a `RateProvider` port for the quotes,
validates that all 7 types arrived complete, and replaces the 7 rows in one statement; any failure keeps
the stored rows and writes a failure record. The only provider adapter is dolarapi.com (`GET /v1/dolares`)
with a fake for tests and e2e. The 60-minute schedule lives in a one-row table claimed atomically in SQL,
and it is driven by a polling job that runs inside the existing worker process next to the email worker,
never in the API process and never in a request path. `GET /exchange-rates/latest` reads the stored rows
for an authenticated user. Rates are bigint integers scaled by 10,000 end to end: the provider's JSON
numbers are read from their source text (never through a float) and parsed by a shared helper.

Decisions taken in this spec (none changes a PRD requirement):
- **D1, sync host = the worker process.** The API is stateless (AGENTS.md, PRD 01 NFR-09) and can run as
  several replicas, so a timer inside it would fetch once per replica and keep state in memory. The worker
  is already a separate Railway service with `DATABASE_URL`, runs as one or many instances behind row
  claims, and shares `apps/api/src/shared`. The schedule is in the database (`exchange_rate_sync`), so any
  number of workers and any restart see the same next due time, as the email outbox does with
  `next_attempt_at`. Each job catches its own failures, so a rates problem cannot stop email delivery. No
  new service, and no Railway change: the new settings have defaults (FIX-003 keeps the worker parsing only
  the settings it reads, and `RATE_PROVIDER` and `DOLARAPI_BASE_URL` join that set).
- **D2, two timestamps.** Each row stores the provider's `fechaActualizacion` (`provider_updated_at`) and
  the time of our refresh (`fetched_at`), and the read endpoint returns both. The provider's timestamp can
  be a day old for oficial and tarjeta while our refresh ran a minute ago; which of the two drives the "age"
  of DISC-001-03b is that ticket's decision (parent index, pending decision 5), and nothing here changes
  either way.
- **D3, decimals.** dolarapi sends JSON numbers (`1623.3`). The adapter reads each number's source text
  through the `JSON.parse` reviver `context.source` (Node 24.13 supports it; a reviver typed
  `(key: string, value: unknown, context?: { source?: string })` compiles under the repo's `ES2023` lib with no `any`, checked
  2026-10-02) and hands that text to a shared parser that returns a bigint scaled by 10,000. V8 still parses the value into a
  `Number` for the reviver's second argument; the reviver ignores it, and no rate is ever computed from a float. Exponent notation, signs,
  zero, and values above 10,000,000.0000 are invalid; more than 4 decimals round half up.
- **D4, all or nothing.** A refresh stores the 7 types or nothing: a missing type, a `null` or non-positive
  `compra` or `venta`, a duplicate `casa`, or `moneda` other than USD makes the whole refresh a failure
  (checked 2026-10-02: all 7 types, including `tarjeta`, carry both `compra` and `venta`). Unknown `casa`
  values are ignored. Mapping: oficial, blue, bolsa to mep, contadoconliqui to ccl, mayorista, cripto,
  tarjeta.
- **D5, schedule.** A success schedules the next refresh 60 minutes later (NFR-02). A failure schedules a
  retry 5 minutes later so one blip does not leave rates stale for 2 hours; the 5-minute value is a design
  constant, not a requirement (confirmed by the human on 2026-10-02). A claim is a lease of 5 minutes, so a worker that dies mid-refresh is retried
  after the lease. `claim` returns the lease expiry it wrote, and `succeeded` and `failed` update the schedule only while
  `next_attempt_at` still equals that value, so a worker whose lease was taken over cannot overwrite the new owner's schedule. Times
  come from the worker's injected clock, not the database's, as the email outbox does; a few seconds of skew only moves a refresh.
- **D6, no user data.** The three tables hold market data and operational records, have no foreign key to
  `users`, and are not reachable from `users`, so the erasure guard of DISC-001-01f needs no registry entry.
- **D7, no new runtime dependency.** The adapter uses the global `fetch` of Node 24.

Human decisions of 2026-10-02 (relayed by the orchestrator) folded in: no jump guard on refreshed rates (threat R-02 accepted by the
project owner); the 5-minute failure retry is confirmed; FR-03, AC-04 and AC-05 are accepted as part of this ticket.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 2, Block 3, Block 4, Block 5 |
| FR-02 | Block 2, Block 3, Block 4, Block 5 |
| FR-03 | Block 1, Block 6 |
| NFR-01 | Strategy: bigint columns and bigint fields only; `scaled-rate` parser works on decimal text; a schema-introspection test asserts no float or numeric column in the three tables and a source scan asserts no `Number`/`parseFloat` on rates (Blocks 1, 3, 7) |
| NFR-02 | Strategy: success schedules `next_attempt_at = now + 60 min` in `exchange_rate_sync`; the job polls every 30 s and claims atomically; tested with a mutable clock and with two concurrent jobs (Blocks 2, 3, 5) |
| NFR-03 | Strategy: the read use case and route depend only on the repository port, never on the provider port; the provider is constructed only in `worker.ts`; a route test wires a provider spy that must record 0 calls, and a source scan asserts that `infrastructure/http` and `get-latest-rates.ts` do not import the provider (Blocks 5, 6, 7) |

## Dependencies between blocks
Block 1 (shared) first. Block 2 (domain and ports) needs Block 1. Blocks 3 (persistence) and 4 (provider
adapters) need Block 2 and are independent of each other. Block 5 (job, worker, env) needs Blocks 2, 3 and
4. Block 6 (HTTP) needs Blocks 1, 2 and 3. Block 7 (cross-cutting tests and wiring checks) is last.
Execution order: 1, 2, then 3 and 4, then 5 and 6, then 7.

## Block 1 — Shared contracts and the scaled-rate parser

**Files**
- `packages/shared/src/exchange-rates/scaled-rate.ts` (new) — `RATE_SCALE_DECIMALS = 4`, `RATE_SCALE = 10_000n`, `RATE_MAX_SCALED`, `parseScaledRate(text): bigint | null`, `formatScaledRate(value): string`.
- `packages/shared/src/exchange-rates/exchange-rate.ts` (new) — `scaledRateStringSchema`, `exchangeRateSchema`, `latestRatesResponseSchema`, `latestRatesQuerySchema` (an empty object, so unexpected query keys are stripped).
- `packages/shared/src/index.ts` (modified) — exports the two files.
- `packages/shared/src/rate-types.ts` (modified) — the comment now says the exchange-rates module consumes the list; no value changes.
- `packages/shared/test/scaled-rate.test.ts` (new), `packages/shared/test/exchange-rate-schemas.test.ts` (new).

**Logic**
`parseScaledRate` takes the exact decimal text of a provider number and returns a bigint scaled by 10,000, or
`null`. Accepted text: `^(0|[1-9]\d*)(\.\d+)?$`. More than 4 decimals round half up on the decimal digits
(string arithmetic on bigint, no float). `null` for anything else, for zero, and for a result above
`RATE_MAX_SCALED` (10,000,000.0000 scaled = `100_000_000_000n`). `formatScaledRate` renders a scaled bigint as
`"1623.3000"` for logs and tests. The response contract is `{ rates: [{ rateType, buy,
sell, providerUpdatedAt, fetchedAt }] }` for the latest-rates read (Block 6), where `buy` and `sell` are decimal integer strings (the scaled
value, like amounts travel as minor-unit strings) and the two timestamps are ISO 8601 strings.

**Input validation**
`scaledRateStringSchema`: a positive decimal integer string, at most 12 digits, no leading zeros,
value within `1..RATE_MAX_SCALED`. `rateType` uses `rateTypeSchema`. The module takes no request input.

**Error handling**
- `parseScaledRate` returns `null` for malformed, zero, exponent, signed, empty and oversized text; it never throws.
- The response schema rejects a rate that is zero, negative, non-integer or oversized when a handler builds a bad body (the typed `validate` response check fails closed).

**Required tests**
- [ ] `1623.3` parses to `16233000n`, `1545` to `15450000n`, `1614.03` to `16140300n`, `0.0001` to `1n` — validates NFR-01
- [ ] more than 4 decimals round half up (`1.00005` to `10001n`, `1.00004` to `10000n`) — validates NFR-01
- [ ] malformed text returns `null` (empty, `-1`, `1e3`, `1,5`, `abc`, ` 1`, `01`, `1.`) — error path
- [ ] zero and a value above 10,000,000.0000 return `null` — error path
- [ ] no value passes through `Number`: a 30-digit text keeps every digit — validates NFR-01
- [ ] the response schema accepts a 7-entry body and an empty `rates` array — validates AC-03, AC-05
- [ ] the response schema rejects a zero rate, a non-integer string and an unknown rate type — error path

**Completion criterion**
The shared tests pass, `pnpm typecheck` passes, and `@pesly/shared` exports `parseScaledRate` and
`latestRatesResponseSchema`.

## Block 2 — Domain, ports and use cases

**Files**
- `apps/api/src/exchange-rates/domain/rate-quote.ts` (new) — `RateQuote`, `StoredRate`, `assertCompleteQuotes`.
- `apps/api/src/exchange-rates/domain/errors.ts` (new) — `RateProviderFailure` with a closed `code`.
- `apps/api/src/exchange-rates/application/ports/rate-provider.ts` (new) — `RateProvider.fetchQuotes()`.
- `apps/api/src/exchange-rates/application/ports/rate-repository.ts` (new) — `replaceAll`, `findAll`.
- `apps/api/src/exchange-rates/application/ports/refresh-schedule.ts` (new) — `claim`, `succeeded`, `failed`.
- `apps/api/src/exchange-rates/application/ports/refresh-failure-log.ts` (new) — `record`, `purgeOlderThan`.
- `apps/api/src/exchange-rates/application/ports/clock.ts` (new) — `Clock.now()`; local on purpose, so the module does not import identity.
- `apps/api/src/exchange-rates/application/refresh-rates.ts` (new) — `RefreshRates`.
- `apps/api/src/exchange-rates/application/get-latest-rates.ts` (new) — `GetLatestRates`.
- `apps/api/test/exchange-rates/fakes.ts` (new) — in-memory repository, schedule, failure log, scriptable provider.
- `apps/api/test/exchange-rates/refresh-rates.test.ts` (new), `apps/api/test/exchange-rates/rate-quote.test.ts` (new).

**Logic**
`RateQuote = { rateType, buy: bigint, sell: bigint, providerUpdatedAt: Date }`. `assertCompleteQuotes(quotes)`
requires exactly the 7 `RATE_TYPES`, each once, with `buy` and `sell` in `1..RATE_MAX_SCALED`, and returns them
ordered by `RATE_TYPES`; otherwise it throws `RateProviderFailure('provider_invalid_payload', detail)` where
`detail` names the missing or invalid type (never provider text). `RateProviderFailure.code` is one of
`provider_unreachable`, `provider_timeout`, `provider_bad_status`, `provider_invalid_payload`.
`RefreshRates.execute()`: (1) `schedule.claim(now, leaseMs = 5 min)`; false returns `{ outcome: 'not_due' }`.
(2) `provider.fetchQuotes()` then `assertCompleteQuotes`. (3) `rates.replaceAll(quotes, fetchedAt = clock.now())`
then `schedule.succeeded(now, 60 min)` and `{ outcome: 'refreshed' }`. (4) On `RateProviderFailure`:
`failures.record({ at, code, statusCode?, detail? })`, `schedule.failed(now, 5 min)`, `{ outcome: 'failed', code }`;
the stored rows are untouched because step 3 never ran. (5) Any other error (storage) is rethrown: the lease
expires and the job retries. `GetLatestRates.execute()` returns `rates.findAll()` ordered by `RATE_TYPES`; it
has no provider dependency.

**Error handling**
- Provider unreachable, timeout, bad status or invalid payload: failure recorded, schedule moved by the retry delay, stored rates kept, outcome `failed` (never thrown).
- Incomplete quotes (missing type, non-positive price, duplicate type): `provider_invalid_payload` with the type named in `detail`; nothing stored.
- Storage failure in `replaceAll` or in the schedule: rethrown to the job, which logs it; no failure record claims a provider fault.
- `claim` false: nothing runs, no failure recorded.

**Required tests**
- [ ] a successful refresh stores the 7 quotes with `fetchedAt` and moves the schedule 60 minutes ahead — validates AC-01, NFR-02
- [ ] a refresh that is not due calls no provider and stores nothing — validates NFR-02
- [ ] an unreachable provider is an error outcome: stored rates stay identical, one failure recorded with `provider_unreachable`, retry in 5 minutes — validates AC-02
- [ ] a provider timeout records `provider_timeout`; a 500 status records `provider_bad_status` with the status code — validates AC-02
- [ ] a missing rate type, an invalid zero price and a duplicate type each yield `provider_invalid_payload`, store nothing and keep the old rows — validates AC-02
- [ ] a storage error is rethrown and records no provider failure — error path
- [ ] `GetLatestRates` returns the stored rows in `RATE_TYPES` order and an empty list when none exist — validates AC-03, AC-05
- [ ] `GetLatestRates` has no provider in its constructor and calls none — validates NFR-03

**Completion criterion**
The listed tests pass against the in-memory fakes; `apps/api/src/exchange-rates/domain` and `application`
import nothing from `infrastructure`, `drizzle-orm`, `pg`, `express` or `node:*` (the architecture lint passes).

## Block 3 — Persistence: tables, migration 0012, repositories

**Files**
- `apps/api/src/exchange-rates/infrastructure/db/schema.ts` (new) — the three tables.
- `apps/api/drizzle/0012_exchange_rates.sql` (new, generated) — the DDL.
- `apps/api/drizzle/meta/0012_snapshot.json` (new, generated) and `apps/api/drizzle/meta/_journal.json` (modified) — idx 12.
- `apps/api/drizzle/rollback/0012_exchange_rates.down.sql` (new) — destructive reverse, documented.
- `apps/api/src/exchange-rates/infrastructure/db/drizzle-rate-repository.ts` (new).
- `apps/api/src/exchange-rates/infrastructure/db/drizzle-refresh-schedule.ts` (new).
- `apps/api/src/exchange-rates/infrastructure/db/drizzle-refresh-failure-log.ts` (new).
- `apps/api/drizzle.config.ts` (unchanged: its glob `./src/*/infrastructure/db/schema.ts` already matches the new schema file).
- `apps/api/test/identity/migration.test.ts` (modified) — `ALL_MIGRATIONS` 8 becomes 9 and `ALL_TABLES` gains `exchange_rate_refresh_failures`, `exchange_rate_sync` and `exchange_rates` (alphabetical, asserted at every `ALL_TABLES` check); every rollback chain starts with `rollback('0012_exchange_rates')` because 0012 has the newest `when` (the chains at the current lines 207, 244, 328, 387, 421, 474, 546, 631, 785 and 817 shift by this); the `ALL_MIGRATIONS - n` offsets stay valid; a new `describe` covers `0012_exchange_rates` (apply, rollback, journal order).
- `apps/api/test/deploy/build-output.test.ts` (modified) — its own `ALL_TABLES` copy (asserted near line 112) gains the three tables.
- `apps/api/test/exchange-rates/rate-repository.test.ts` (new), `apps/api/test/exchange-rates/refresh-schedule.test.ts` (new), `apps/api/test/exchange-rates/refresh-failure-log.test.ts` (new).

**Data model**
- `exchange_rates`: `rate_type text primary key` (check in the 7 values); `buy bigint not null` and `sell bigint not null` (each check `between 1 and 100000000000`); `provider_updated_at timestamptz not null`; `fetched_at timestamptz not null`. One row per type, replaced in place. No index beyond the primary key.
- `exchange_rate_sync`: `id smallint primary key` (check `id = 1`); `next_attempt_at timestamptz not null`; `last_success_at timestamptz null`; `consecutive_failures integer not null default 0` (check `>= 0`). A single row, created by the first claim.
- `exchange_rate_refresh_failures`: `id uuid primary key default gen_random_uuid()`; `failed_at timestamptz not null`; `code text not null` (check in the four codes); `status_code smallint null` (check `between 100 and 599`); `detail text null` (check `char_length <= 200`); index `exchange_rate_refresh_failures_failed_at_idx` on `failed_at`.
- No float, real, double or numeric column anywhere; no foreign key to `users`.
- No table is seeded: `apps/api/test/helpers/test-database.ts` truncates every public table before each test, so the repositories work on empty tables (the sync row is created by the first claim, the rate rows by the first refresh) and no test needs to re-seed.
- Migration `0012_exchange_rates` creates the three tables, checks and the index; it is non-destructive. Its journal `when` must be greater than every other entry on `main` at merge time (the current newest is `1790895423195`; the open branches already use up to `1790902441319`); the migration test asserts the newest entry is the last and has the greatest `when` (the existing journal is not monotonic: idx 7 is older than idx 6, so the check is "greater than every other entry", not "greater than the previous one"), and `drizzle-kit generate` would name the file `0008_*`, so CODE renames the generated files to `0012`, sets `idx` 12 in the journal by hand and runs `drizzle-kit check` (it tolerates the gap). CODE must regenerate or bump the value if another migration lands first, because drizzle skips a migration whose `when` is older than the last applied one. The gap at 0008 to 0011 is intentional: those numbers are reserved by other open tickets (0008 investments, 0009 categories, 0010 account deletion, 0011 available balance), and 0009 already leaves the same gap; the migrations applied on `main` are 0000 to 0007, so `ALL_MIGRATIONS` is a count of applied migrations, not an index.
- Rollback `0012_exchange_rates.down.sql`: drops the failures index and the three tables and deletes its row from `drizzle.__drizzle_migrations` by its `when`; destructive (stored rates and failure records are lost, harmless because the next refresh rebuilds them), asks to stop the worker first, and is applied before the rollback of any older migration.

**Logic**
`replaceAll(quotes, fetchedAt)` is one `INSERT ... ON CONFLICT (rate_type) DO UPDATE` statement for the 7 rows, so
readers see the old set or the new set, never a mix. `findAll()` returns the rows as bigint (`mode: 'bigint'`).
`claim(now, leaseMs)` is one atomic statement: `INSERT INTO exchange_rate_sync (id, next_attempt_at) VALUES (1, now + lease)
ON CONFLICT (id) DO UPDATE SET next_attempt_at = excluded.next_attempt_at WHERE exchange_rate_sync.next_attempt_at <= now RETURNING id`;
a returned row means this worker owns the refresh, and `claim` returns the lease expiry it wrote. `succeeded(lease, now, intervalMs)` sets
`next_attempt_at = now + interval`, `last_success_at = now`, `consecutive_failures = 0`, and `failed(lease, now, retryMs)` sets
`next_attempt_at = now + retry` and increments `consecutive_failures`; both add `WHERE next_attempt_at = lease`, so a stale owner changes nothing. `record` inserts one failure row; `purgeOlderThan(cutoff)` deletes older rows and returns the count.

**Error handling**
- A unique or check violation cannot come from valid quotes (`assertCompleteQuotes` runs first); if one occurs it is a programming error and is rethrown, not swallowed.
- A concurrent claim by another worker returns false (no row), not an error.
- A database outage rejects the repository call; the use case rethrows it (Block 2).

**Required tests**
- [ ] `replaceAll` stores 7 rows and a second call replaces them all in place (7 rows remain) — validates AC-01
- [ ] values above `int64` safe integer range survive a round trip as bigint (exact) — validates NFR-01
- [ ] a rate of 0 or below, or above the maximum, is rejected by the check constraint (invalid value) — error path
- [ ] an unknown `rate_type` is rejected by the check constraint (invalid value) — error path
- [ ] a database error while replacing the rates leaves the previous 7 rows in place — error path
- [ ] `findAll` on an empty table returns an empty list — validates AC-05
- [ ] `claim` succeeds the first time, fails while the lease is open, succeeds again once `next_attempt_at` has passed — validates NFR-02
- [ ] two simultaneous claims: exactly one returns true — validates NFR-02
- [ ] `succeeded` sets the next attempt 60 minutes ahead and resets failures; `failed` sets it 5 minutes ahead and counts failures — validates NFR-02, AC-02
- [ ] a stale owner (its lease was taken over) calling `succeeded` or `failed` changes nothing — error path
- [ ] a failure record round trips with code, status code and detail, and `purgeOlderThan` deletes only older rows — validates AC-02
- [ ] introspection: the three tables have no float, real, double or numeric column and no foreign key to `users` — validates NFR-01
- [ ] migration test: 0012 applies on top of the previous ones, its rollback removes the three tables, the journal's newest entry is `0012_exchange_rates` with the greatest `when` — validates NFR-01

**Completion criterion**
Repository, schedule and failure-log tests pass against the migrated test database; `drizzle-kit check` is clean;
`apps/api/test/identity/migration.test.ts` counts the new migration and tables.

## Block 4 — Provider adapters: dolarapi and the fake

**Files**
- `apps/api/src/exchange-rates/infrastructure/provider/dolarapi-rate-provider.ts` (new).
- `apps/api/src/exchange-rates/infrastructure/provider/dolarapi-payload.ts` (new) — pure mapping and validation of the payload.
- `apps/api/src/exchange-rates/infrastructure/provider/fake-rate-provider.ts` (new) — canned quotes, selectable by `RATE_PROVIDER=fake`.
- `apps/api/test/exchange-rates/dolarapi-payload.test.ts` (new), `apps/api/test/exchange-rates/dolarapi-rate-provider.test.ts` (new, against a local stub HTTP server, never the real host).
- `apps/api/test/exchange-rates/fixtures/dolarapi-2026-10-02.json` (new) — the payload shape observed on 2026-10-02 (7 entries, `compra` and `venta` as JSON numbers).

**Logic**
`DolarapiRateProvider({ baseUrl, timeoutMs = 10_000 })` issues `GET {baseUrl}/v1/dolares` with `redirect: 'manual'` (a 3xx answer is never followed),
`AbortSignal.timeout(timeoutMs)` and `Accept: application/json`. A network error maps to `provider_unreachable`; an abort maps to
`provider_timeout` (the adapter matches both `TimeoutError`, which `AbortSignal.timeout` raises, and `AbortError`); any status outside 2xx,
redirects included, maps to `provider_bad_status` (with the status code), a response whose `Content-Type` is not
JSON or whose body exceeds 65,536 bytes (read with a cap, never unbounded) to `provider_invalid_payload`. The body text is parsed
with `JSON.parse(text, reviver)` where the reviver reads `context.source` for every number under `compra` and `venta` and keeps that
text (see D3); `dolarapi-payload.ts` maps each entry (`moneda` must be `USD`, `casa` mapped per D4, unknown `casa` ignored, `fechaActualizacion`
an ISO date) to a `RateQuote` using `parseScaledRate`, throwing `provider_invalid_payload` (detail names the `casa`, never the payload) for a
`null`, missing, malformed or non-positive price or an unparseable date. The adapter never logs or stores response bodies. The fake returns
the 7 quotes of the fixture, with a deterministic `providerUpdatedAt`, and can be scripted to fail for tests.

**Input validation**
The only input is the provider's response, which is untrusted: status in 2xx, `Content-Type` JSON, body at most 65,536 bytes, the top level an array,
each entry an object whose `moneda` is the string `USD`, whose `casa` is a string, whose `compra` and `venta` are JSON numbers that `parseScaledRate`
accepts (positive, at most 10,000,000.0000), and whose `fechaActualizacion` is a valid ISO date; unknown `casa` entries are skipped, and the 7 types
must each appear exactly once. The adapter takes no user input.

**Error handling**
- Connection refused, DNS failure: `provider_unreachable`.
- No answer within 10 s: `provider_timeout`.
- HTTP 3xx (redirects are not followed), 4xx or 5xx: `provider_bad_status` with the status code.
- Wrong content type, body over 64 KiB, invalid JSON, wrong top-level shape, bad entry: `provider_invalid_payload`.

**Required tests**
- [ ] the 2026-10-02 fixture maps to 7 quotes with exact scaled values (`1623.3` is `16233000n`, `2008.5` is `20085000n`) — validates AC-01, NFR-01
- [ ] `bolsa` maps to `mep` and `contadoconliqui` to `ccl`; an unknown `casa` is ignored — validates AC-01
- [ ] a `null` `compra`, a missing `venta`, a negative price and a string price each fail with `provider_invalid_payload` naming the `casa` — validates AC-02
- [ ] a missing type, a duplicate `casa` and a `moneda` other than USD fail with `provider_invalid_payload` — validates AC-02
- [ ] an unparseable `fechaActualizacion` fails with `provider_invalid_payload` — error path
- [ ] against the local stub: HTTP 500 gives `provider_bad_status` with 500; a 302 gives `provider_bad_status` and is not followed; a closed port gives `provider_unreachable` (error cases) — validates AC-02
- [ ] a stub that never answers gives `provider_timeout` (with a short injected timeout; an abort error maps the same way) — validates AC-02
- [ ] a body over 64 KiB and a non-JSON content type give `provider_invalid_payload` — validates AC-02
- [ ] the fake returns 7 complete quotes and can be scripted to fail — validates AC-01

**Completion criterion**
The adapter and payload tests pass using only the local stub server and the fixture; no test reaches `dolarapi.com`.

## Block 5 — Sync job, worker wiring and environment

**Files**
- `apps/api/src/exchange-rates/infrastructure/jobs/rates-sync-job.ts` (new) — polling loop with `runOnce`, `start`, `stop`, hourly failure-log purge.
- `apps/api/src/exchange-rates/infrastructure/system-clock.ts` (new) — the module's real `Clock`.
- `apps/api/src/exchange-rates/index.ts` (new) — module barrel: exports `createRatesSyncJob({ db, provider, logger, clock? })`, which builds the repositories, the schedule, the failure log and `RefreshRates` and returns the job, so `worker.ts` never imports a Drizzle repository (the same shape as `createEmailWorker`); also exports the route factory of Block 6.
- `apps/api/src/worker.ts` (modified) — builds the provider by `RATE_PROVIDER`, starts both jobs, stops both on shutdown.
- `apps/api/src/shared/config/env.ts` (modified) — `RATE_PROVIDER` and `DOLARAPI_BASE_URL` in the worker's fields, with production rules.
- `.env.example` (modified) — documents both settings.
- `playwright.config.ts` (modified) — `RATE_PROVIDER: 'fake'` in `WORKER_ENV` (which `API_ENV` spreads), so e2e never reaches dolarapi.com; the `email worker started` log line that the worker's `wait` matches stays exactly as is.
- `apps/api/test/helpers/test-env.ts` (modified) — `RATE_PROVIDER: 'fake'` in the test environment source; `productionOverrides` sets nothing new (the defaults satisfy the production rules).
- `apps/api/test/exchange-rates/rates-sync-job.test.ts` (new), `apps/api/test/foundation/env.test.ts` (modified), `apps/api/test/foundation/worker-env.test.ts` (modified: `WORKER_PRODUCTION` and its "exactly the seven settings" comment stay true because the two new settings are optional with defaults, and the test now says so).
- `.railway/railway.ts`, `apps/api/test/deploy/railway-iac.test.ts` and `.github/workflows/ci.yml` (unchanged on purpose): `RATE_PROVIDER` defaults to `dolarapi` and the production rule passes with the defaults, so the worker's production environment needs no new literal and the IaC allow-list (`argent-worker` = exactly what `parseWorkerEnv` reads) is untouched; CI unit tests inject fakes and the e2e job pins `fake` through `playwright.config.ts`. CODE must run `railway-iac.test.ts` to confirm this.

**Logic**
`RatesSyncJob` polls every 30 s (`RATES_POLL_INTERVAL_MS`): `runOnce()` calls `RefreshRates.execute()` and, at most once an hour,
`failures.purgeOlderThan(now - 30 days)`. It logs outcomes with counts and codes only (`rates refreshed`, `rates refresh failed {code}`,
`rates refresh errored`), never provider text. A thrown error is caught, logged and the next tick runs (same shape as `EmailWorker.start`).
`stop()` waits for the pass in progress. `worker.ts` builds `DolarapiRateProvider` or the fake from `env.RATE_PROVIDER`, passes it to `createRatesSyncJob`, starts the rates job
beside the email worker and stops both in `close`. The existing `email worker started` log line stays (Playwright waits for it) and a
`rates sync started` line is added. Environment: `RATE_PROVIDER` is `dolarapi` or `fake`, default `dolarapi`; `DOLARAPI_BASE_URL` is a URL,
default `https://dolarapi.com`. Both live in `workerFields`, which `envSchema` also spreads, so the API's `Env` carries them with the same defaults (the API never reads them); `RawWorkerEnv` gains the two fields and `workerProductionIssues` carries the production rules, following `emailIssues` and the pinned Google URLs. In production `RATE_PROVIDER` must be `dolarapi` and `DOLARAPI_BASE_URL` must be exactly the default (a
misconfigured URL would send the worker's requests elsewhere), as the Google URLs are pinned.

**Error handling**
- Invalid `RATE_PROVIDER` or a non-URL `DOLARAPI_BASE_URL`: startup fails listing the variable name, never the value (existing `parseWith`).
- `RATE_PROVIDER=fake` or a changed `DOLARAPI_BASE_URL` in production: startup fails with the rule.
- A pass that throws (storage outage): logged, next tick retries; the email worker is unaffected.
- `stop()` during a refresh: the refresh finishes its current statement and the loop ends.

**Required tests**
- [ ] a job pass with a due schedule and the fake provider stores 7 rates (real database) — validates AC-01
- [ ] a job pass with an unreachable provider (error) keeps the previous rates and records the failure (real database) — validates AC-02
- [ ] with a mutable clock, no refresh runs at 59 minutes after a success and one runs at 60 — validates NFR-02
- [ ] two jobs running the same pass concurrently trigger exactly one provider call — validates NFR-02
- [ ] a storage error in a pass is logged and the next pass runs (error path) — validates AC-02
- [ ] the failure-log purge removes records older than 30 days and keeps newer ones — validates AC-02
- [ ] env: defaults are `dolarapi` and `https://dolarapi.com`; `fake` is accepted outside production — validates NFR-02
- [ ] env: an unknown `RATE_PROVIDER` and a non-URL base URL are each rejected by name only, with no value printed (invalid input) — error path
- [ ] env: `fake` in production and a changed base URL in production are each rejected (invalid in production) — error path
- [ ] `stop()` during a refresh lets the statement in flight finish and ends the loop with no further provider call (error path: shutdown) — error path
- [ ] the worker's environment parser accepts the new settings without any API-only setting — validates NFR-03

**Completion criterion**
Job, env and worker-env tests pass; `pnpm --filter @pesly/api worker` starts with the fake provider and logs both start lines;
the Playwright worker command still matches `email worker started`.

## Block 6 — HTTP: the latest-rates endpoint and composition

**Files**
- `apps/api/src/exchange-rates/infrastructure/http/exchange-rate-routes.ts` (new) — `createExchangeRateRoutes`.
- `apps/api/src/exchange-rates/infrastructure/http/exchange-rate-presenter.ts` (new).
- `apps/api/src/server.ts` (modified) — adds the router factory.
- `apps/api/test/exchange-rates/exchange-rate-routes.test.ts` (new).

**API contract**
- Method and path: `GET /exchange-rates/latest`.
- Request: no body, no query, no params.
- Response 200: `{ rates: [{ rateType: 'oficial' | 'blue' | 'mep' | 'ccl' | 'mayorista' | 'cripto' | 'tarjeta', buy: string, sell: string, providerUpdatedAt: string, fetchedAt: string }] }`.
  `buy` and `sell` are decimal integer strings scaled by 10,000; timestamps are ISO 8601 UTC; entries follow the order of `RATE_TYPES`. When no refresh has succeeded, `rates` is `[]` with status 200.
- Error codes: 401 `UNAUTHENTICATED` (no or invalid session), 403 `EMAIL_NOT_VERIFIED` (verified-email gate, same as `/accounts`), 429 is not used.
- Auth: `requireSession` then `requireVerifiedEmail` on the `/exchange-rates` prefix; the data is global market data, so there is no owner scope, and no answer depends on who asks.

**Logic**
The factory receives the repository (through `GetLatestRates`) and no provider. The handler returns `presentLatestRates(rates)`, which
formats bigints with `formatScaledRate`-style integer strings and dates with `toISOString()`. The response is typed by
`latestRatesResponseSchema` through the shared `validate` middleware.

**Input validation**
The route accepts no input. It declares `latestRatesQuerySchema` (an empty object) with the shared `validate` middleware, so unexpected query keys are stripped and never reach the handler, and no body or params are declared or read. The response is validated by `latestRatesResponseSchema`.

**Error handling**
- No session: 401 `UNAUTHENTICATED` and no rates in the body.
- Session without a verified email: 403 `EMAIL_NOT_VERIFIED`.
- Database outage: 500 `INTERNAL` through the shared error handler, no stack trace or SQL in the body.

**Required tests**
- [ ] a verified user receives the 7 stored rates with scaled strings and both timestamps — validates AC-03
- [ ] with nothing stored the answer is 200 and `{ rates: [] }` — validates AC-05
- [ ] a request with no session answers 401 `UNAUTHENTICATED` with no rates — validates AC-04
- [ ] a session without a verified email answers 403 `EMAIL_NOT_VERIFIED` — error path
- [ ] a database failure answers 500 `INTERNAL` with only `{ code }` — error path
- [ ] after a read, the provider spy wired into the test app has 0 calls — validates NFR-03
- [ ] the response body passes `latestRatesResponseSchema` and contains no number-typed rate — validates NFR-01

**Completion criterion**
Route tests pass; `GET /exchange-rates/latest` is mounted by `server.ts` behind `requireSession` and `requireVerifiedEmail`.

## Block 7 — Cross-cutting checks

**Files**
- `apps/api/test/exchange-rates/no-float-rates.test.ts` (new) — static scan of the module and shared files.
- `apps/api/test/exchange-rates/request-path.test.ts` (new) — static scan that the HTTP layer and `get-latest-rates.ts` never import the provider port or an adapter.
- `apps/api/test/foundation/architecture-boundaries.test.ts` (modified) — a block mirroring the accounts one, with probe files `apps/api/src/exchange-rates/domain/probe.ts` and `apps/api/src/exchange-rates/application/probe.ts` (the `eslint.config.mjs` globs already cover the module through `*/`, so the config does not change).
- `apps/api/test/helpers/test-database.ts` (unchanged: it empties every public relation before each test, the new ones included).

**Logic**
The scans read source text only. The no-float scan fails on `parseFloat`, `Number(`, `.toFixed`, `Math.round` or a `number` type on any identifier
named rate, buy or sell in `apps/api/src/exchange-rates` and `packages/shared/src/exchange-rates`. The request-path scan fails if a file under
`infrastructure/http` or `application/get-latest-rates.ts` imports `rate-provider`, `dolarapi-rate-provider` or `fake-rate-provider`.

**Error handling**
- A failed scan names the file and the offending token; the tests make no network call and write no file.

**Required tests**
- [ ] no-float scan passes on the module and fails on a probe containing `parseFloat` (the probe is an in-memory string) — validates NFR-01
- [ ] request-path scan passes on the module and fails on a probe importing the provider port — validates NFR-03
- [ ] architecture probes: an infrastructure import in `exchange-rates/domain` and in `exchange-rates/application` is rejected — error path
- [ ] the whole API suite passes with the new migration, tables and env — validates NFR-02

**Completion criterion**
`pnpm test`, `pnpm lint` and `pnpm typecheck` pass; the migration count and journal checks include 0012.

## Final verification
- FR-01 and FR-02: with the fake provider the worker stores 7 rates; with a failing provider it keeps them and writes a failure record.
- FR-03: an authenticated, verified user reads the 7 stored rates; no session is 401; an empty table is 200 with `[]`.
- NFR-01: no float anywhere in the module, the tables or the shared helper; the provider's numbers are never converted through `Number`.
- NFR-02: the schedule is stored in the database, 60 minutes after a success, claimed atomically by any number of workers.
- NFR-03: the API process never constructs a provider; the read path and the tests prove 0 provider calls.
- Rollback: stop the worker, run `apps/api/drizzle/rollback/0012_exchange_rates.down.sql` as a whole, then revert the commits; the API without the module keeps working because no other module reads these tables.
- No real call to dolarapi.com exists in any test, fixture or e2e flow.
