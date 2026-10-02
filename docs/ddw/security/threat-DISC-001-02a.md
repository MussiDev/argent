# Threat model DISC-001-02a: Accounts

| Field | Value |
|-------|-------|
| Ticket | DISC-001-02a |
| Spec | docs/ddw/specs/spec-DISC-001-02a.md |
| Tier | FEATURE |
| Date | 2026-10-01 |

Risk identifiers are local to this ticket (R-01 to R-16).

## Components
| Component | Source in the spec |
|---|---|
| `packages/shared/src/money.ts` + `packages/shared/src/accounts/account.ts` (bigint helpers, request and response contracts) | Block 1 |
| `packages/shared/src/errors.ts` + `apps/api/src/shared/http/error-handler.ts` (`ACCOUNT_NAME_TAKEN`, `ACCOUNT_HAS_MOVEMENTS`, 409) | Block 2 |
| `apps/api/src/accounts/application/accounts-service.ts` + `apps/api/src/accounts/application/ports/account-movements.ts` (use cases and the movements port) | Block 3 |
| `apps/api/src/accounts/infrastructure/db/schema.ts` + `apps/api/drizzle/0006_accounts.sql` (`accounts` table, unique name index, immutability trigger) + `apps/api/drizzle/rollback/0006_accounts.down.sql` | Block 4 |
| `apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts` + `apps/api/src/accounts/infrastructure/movements/no-movements-adapter.ts` | Block 4 |
| `apps/api/src/accounts/infrastructure/http/account-routes.ts` (`POST /accounts`, `GET /accounts`, `GET /accounts/:id`, `PATCH /accounts/:id`, `POST /accounts/:id/archive`, `POST /accounts/:id/unarchive`, `DELETE /accounts/:id`) + `apps/api/src/server.ts` wiring | Block 5 |
| `apps/web/src/lib/api-client.ts` account methods | Block 6 |
| `apps/web/src/features/accounts/containers/accounts-container.tsx` + `apps/web/src/features/accounts/components/account-list.tsx` + `apps/web/src/features/accounts/components/account-form.tsx` | Block 7 |

## Trust boundaries
- Browser → API (Express): public internet; account names, types, currencies and opening balances in requests, balances and totals in responses, session cookies, all over TLS; the origin guard and `X-Requested-With: argent` protect state-changing routes.
- API (accounts routes) → accounts application layer: the authenticated user id and the `AccessScope` issued by the `AccessPolicy` cross here; the request body has already been parsed by the shared Zod schemas.
- Accounts application layer → PostgreSQL: private network; the owner-scoped `accounts` rows.
- Accounts application layer → `AccountMovements` port: the boundary PRD 03 will implement; only account ids already filtered by the scope cross it, and signed amounts come back.
- Web containers → presentational components: balances and names reach the DOM only through React's escaping.

## STRIDE analysis
### `packages/shared/src/money.ts` + `packages/shared/src/accounts/account.ts` (bigint helpers, request and response contracts)
- **Spoofing:** not applicable to pure functions; the contracts never carry a user id, owner or role, so a client cannot name another owner (R-01).
- **Tampering:** amounts are decimal integer strings inside the int64 range, parsed to `bigint`; floats, exponents and decimals are refused, the stored opening balance is bounded to plus or minus 10^15 minor units, and derived balances and totals use exact `bigint` arithmetic that cannot overflow or throw (R-04); `type` and `currency` on rename are declared `z.never()` so they cannot be changed by mass assignment (R-03).
- **Repudiation:** none; pure functions with no side effects.
- **Information Disclosure:** names with control, zero-width or bidirectional-override characters are refused, so a name cannot hide or reorder text for a later viewer (R-16); validation failures list field paths only and never echo submitted values; the response schema strips undeclared fields (R-10).
- **Denial of Service:** `limit` is capped at 100 and names at 50 code points; amount strings are at most 20 characters; the 16 kb body limit applies (R-09).
- **Elevation of Privilege:** nothing in the contracts grants a role or an access level; ownership is decided server-side from the session.

### `packages/shared/src/errors.ts` + `apps/api/src/shared/http/error-handler.ts` (`ACCOUNT_NAME_TAKEN`, `ACCOUNT_HAS_MOVEMENTS`, 409)
- **Spoofing:** not applicable.
- **Tampering:** the code and status mapping is a compile-time `Record`, so a missing mapping does not build.
- **Repudiation:** rejected requests are logged with request id, route, status and code.
- **Information Disclosure:** the body is only `{ code }`; the 409 answers are returned only for accounts the caller owns, because another user's account answers 404 first, so neither code confirms that someone else's account or name exists (R-08).
- **Denial of Service:** none beyond the shared handler.
- **Elevation of Privilege:** none; the codes change no state.

### `apps/api/src/accounts/application/accounts-service.ts` + `apps/api/src/accounts/application/ports/account-movements.ts` (use cases and the movements port)
- **Spoofing:** every operation receives an `AccessScope` issued from the session's `AuthContext`; use cases never read a user id from input (R-01).
- **Tampering:** delete checks `hasMovements` and the database foreign key is the second line of defence, so a movement recorded between the check and the delete still blocks it (R-06); balances are added with the shared bigint helpers (R-04).
- **Repudiation:** create, archive, unarchive and delete emit an audit log line with user id and account id only (R-11).
- **Information Disclosure:** the movements port receives only account ids that the scoped repository returned, so an adapter cannot be asked about another user's accounts through this module (R-13).
- **Denial of Service:** one batched port call per request, in chunks of at most 500 ids, and aggregate queries for totals, so cost does not grow with one round trip per account (R-09).
- **Elevation of Privilege:** a write needs `AccessScope<'write'>`, a type only the policy can issue; group access is denied until PRD 05 (R-01).

### `apps/api/src/accounts/infrastructure/db/schema.ts` + `apps/api/drizzle/0006_accounts.sql` (`accounts` table, unique name index, immutability trigger) + `apps/api/drizzle/rollback/0006_accounts.down.sql`
- **Spoofing:** `owner_id` is `NOT NULL` with a foreign key to `users.id`, so a row cannot exist without a real owner.
- **Tampering:** `CHECK` constraints on name length, type and currency; a trigger refuses any change to `type`, `currency` or `owner_id`; the unique index on (`owner_id`, `lower(name)`) closes the duplicate-name race (R-03, R-05).
- **Repudiation:** `created_at` and `updated_at` are set by the database.
- **Information Disclosure:** the `accounts` rows are financial data and PII-adjacent labels; the database volume is encrypted at rest and rows are only reachable through the scoped repository (R-01).
- **Denial of Service:** the owner index (`owner_id`, `created_at`, `id`) keeps owner-filtered list queries indexed; the migration is additive and fast (R-12).
- **Elevation of Privilege:** the application role needs no new privileges: the migration runs in the pre-deploy step and the runtime role keeps only DML on this table.

### `apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts` + `apps/api/src/accounts/infrastructure/movements/no-movements-adapter.ts`
- **Spoofing:** every method requires an `AccessScope` and a call without a scope issued by the policy fails closed (`assertIssuedScope`).
- **Tampering:** Drizzle parameterized statements only; each read or write is a single statement with the `scopedTo` predicate in its `WHERE`, so there is no check-then-act gap (R-01).
- **Repudiation:** unique and foreign-key violations are mapped to typed domain errors, so the outcome is explicit in logs.
- **Information Disclosure:** a row outside the scope is indistinguishable from a missing one (`null` / `false`), so callers cannot learn which it was (R-01, R-08).
- **Denial of Service:** list queries are paginated and indexed; opening-balance sums are one aggregate query per request (R-09).
- **Elevation of Privilege:** `scopedTo` takes only the owner column here (no group column), so no group membership can widen access before PRD 05.

### `apps/api/src/accounts/infrastructure/http/account-routes.ts` (`POST /accounts`, `GET /accounts`, `GET /accounts/:id`, `PATCH /accounts/:id`, `POST /accounts/:id/archive`, `POST /accounts/:id/unarchive`, `DELETE /accounts/:id`) + `apps/api/src/server.ts` wiring
- **Spoofing:** every route sits behind `requireSession` and `requireVerifiedEmail`; an unverified user gets 403 and no session gets 401 (R-02).
- **Tampering:** state-changing requests need the web origin and `X-Requested-With: argent`, on top of SameSite cookies (R-07); params, query and body go through the shared `validate` middleware and handlers never read `req.body` (R-03).
- **Repudiation:** the request log carries request id, method, route, status and duration; mutating routes add the audit line of R-11.
- **Information Disclosure:** another user's account answers 404 with the same body as a missing id on every route (R-01, R-08); logs never contain names or amounts (R-10).
- **Denial of Service:** `limit` is capped at 100, the JSON body limit is 16 kb and every list is paginated (R-09).
- **Elevation of Privilege:** the scope is built from the session's user id by `OwnerOrGroupMemberAccessPolicy` with the deny-all membership reader; no route accepts an owner id (R-01).

### `apps/web/src/lib/api-client.ts` account methods
- **Spoofing:** the client sends only session cookies with `credentials: 'include'` to the configured API origin and refuses redirects.
- **Tampering:** the id is encoded with `encodeURIComponent` and the query is built with `URLSearchParams` from validated values only.
- **Repudiation:** not applicable; the API logs outcomes.
- **Information Disclosure:** error codes become message keys; API text is never shown (R-10).
- **Denial of Service:** one request per user action; no polling.
- **Elevation of Privilege:** the client holds no privilege; the API decides on every call.

### `apps/web/src/features/accounts/containers/accounts-container.tsx` + `apps/web/src/features/accounts/components/account-list.tsx` + `apps/web/src/features/accounts/components/account-form.tsx`
- **Spoofing:** the containers rely on the session guard of the authenticated shell; an expired session sends the user to sign-in.
- **Tampering:** form values are parsed with the shared schemas and `parseAmountInput`, and the API revalidates everything.
- **Repudiation:** destructive delete asks for an explicit confirmation before the request is sent.
- **Information Disclosure:** account names are rendered only as React text nodes, with no `dangerouslySetInnerHTML`, under the existing CSP (R-14); balances are formatted from strings, never logged.
- **Denial of Service:** none beyond the API limits.
- **Elevation of Privilege:** no client-side check is trusted; hiding an action in the UI grants or removes nothing.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| account name (free text, may hold a bank name or card digits) | PII | `accounts.name`; database volume encrypted with AES-256; reachable only through the owner-scoped repository | TLS 1.2+ |
| account type and currency | financial | `accounts.type`, `accounts.currency`; database volume encrypted with AES-256 | TLS 1.2+ |
| opening balance, balance and totals | financial | `accounts.opening_balance` as `bigint`; balances computed on read and never stored; database volume encrypted with AES-256 | TLS 1.2+, decimal strings |
| owner user id on each account | PII | `accounts.owner_id`; database volume encrypted with AES-256 | TLS 1.2+, never returned to other users |
| movement sums returned by the port | financial | not stored by this module | in process only |
| audit log lines (user id, account id) | PII | log storage of the hosting platform; no names or amounts | internal logging pipeline |
| error codes and message keys | public | not stored | TLS 1.2+ |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | broken object-level authorization: a user reads, renames, archives or deletes another user's account by guessing an id (PRD AC-14) | E | M | H | `AccessScope` issued from the session, `scopedTo` owner predicate in the same statement, 404 identical to a missing id, tests per route and per repository method |
| R-02 | an unverified email account uses financial routes | S | M | M | `requireSession` then `requireVerifiedEmail` on `/accounts`; tests for 401 and 403 on every route |
| R-03 | mass assignment or direct SQL changes the currency, type or owner of an account, corrupting history (PRD AC-05) | T | M | H | rename schema declares `type` and `currency` as `z.never()`; a database trigger refuses changes to `type`, `currency` and `owner_id`; tested at both layers |
| R-04 | precision loss, float arithmetic or int64 overflow corrupts balances, or an overflowing total makes the account list answer 500 (PRD NFR-01, NFR-06, FR-13) | T | M | H | `bigint` column with a CHECK of plus or minus 10^15 on the opening balance and the same bound in the shared validator (400 naming the field, never 500), decimal strings in JSON, exact `bigint` sums (`addExact`, `sumExact`) and unbounded integer-string response validators for derived balances and totals (a total over N accounts is at most N times 10^15 plus movement sums, and `bigint` has no upper limit), an exact 100,000-amount sum test and a 9,300-account route test, no float in tests |
| R-05 | a concurrent create or rename produces two accounts with the same name for one owner | T | L | L | unique index on (`owner_id`, `lower(name)`), violation mapped to `ACCOUNT_NAME_TAKEN` |
| R-06 | an account is deleted while a movement is being recorded against it (check-then-act race), destroying history | T | L | H | `hasMovements` check, then a database foreign key `ON DELETE RESTRICT` required of PRD 03 and mapped to `ACCOUNT_HAS_MOVEMENTS`; tested with a test-only referencing table |
| R-07 | cross-site request forges an archive or delete | S | M | M | origin guard with web origin and `X-Requested-With: argent`, SameSite cookies, tests for the missing header |
| R-08 | enumeration of other users' accounts or names through differing answers | I | M | L | other users' ids answer 404 before any 409 can be produced; names are unique per owner, so a conflict reveals only the caller's own data |
| R-09 | oversized lists, huge id batches or heavy aggregates degrade the service (PRD NFR-02, NFR-03) | D | M | M | `limit` at most 100, 16 kb body limit, owner index, aggregate queries, port called in chunks of at most 500 ids, p95 performance test; the unbounded number of accounts per user is accepted separately (R-15) |
| R-10 | account names or amounts leak through logs, validation messages or error bodies | I | M | M | logs carry routes, ids and statuses only; validation errors list paths only; responses are schema-stripped; web shows message keys only |
| R-11 | a delete, archive or rename cannot be attributed afterwards | R | L | M | audit log line per mutating route with user id and account id only, plus the existing request log with request id |
| R-12 | the migration collides in numbering with sibling tickets or cannot be undone, leaving the database out of sync | T | M | M | provisional number `0006` with an explicit renumber procedure, migration tests for apply, rollback and re-apply, a documented rollback script that is destructive and needs an explicit plan |
| R-13 | a future movements adapter returns or sums movements of other users' accounts | I | L | H | the port only receives scope-filtered account ids and returns data keyed by those ids; the adapter contract and a contract test are PRD 03's obligation, recorded in the spec deferrals |
| R-16 | an account name with control, zero-width or bidirectional-override characters is blank-looking or reorders surrounding text, spoofing another account or member once names are shown to others (PRD FR-14) | S | L | M | the shared name validator refuses Unicode Cc and Cf characters on create and rename (400 naming `body.name`), the web form shows a specific message, tests cover zero-width, right-to-left override, NUL and soft hyphen |
| R-15 | a user (or a stolen session) creates an unbounded number of accounts, growing storage and the cost of the list and totals queries (PRD NFR-02 assumes up to 100 accounts) | D | L | M | accepted, see below; bounded in the meantime by pagination, indexes, aggregate queries and the 500-id chunking (R-09) |
| R-14 | an account name containing markup runs script in the web app (stored XSS) | T | L | H | React renders names as text; no raw HTML sink; the existing CSP blocks inline script; a component test renders a name containing markup as literal text |

## Accepted risks
### R-15
- **Accepted by:** project owner (human decision relayed by the orchestrator in the DISC-001-02a session, 2026-10-01: no cap on accounts per user and no extra write-rate limit).
- **Justification:** the product is a personal finance app with about 10 users, a normal user holds a handful of accounts, and the mitigations of R-09 keep the cost per request bounded; a cap would need a PRD requirement the owner chose not to add.
- **Review conditions:** before opening registration to more than a few hundred users, when the real movements adapter of PRD 03 is benchmarked, or immediately if an account-count anomaly is seen in production.

## Supply chain
No new runtime dependency in any package: Block 7 uses a native `<select>` instead of a Radix select,
Block 1 uses the platform `Intl`, and the API reuses Express, Drizzle, `pg` and Zod already pinned in
`pnpm-lock.yaml`. `pnpm audit --prod --audit-level high` is part of the final verification and must
stay unchanged. No external service is added.

## Availability
The new routes are authenticated and limited by pagination (100), the 16 kb body limit and indexed
owner-filtered queries; one batched movements-port call per request keeps latency bounded as
movements grow (NFR-02, benchmarked in Block 8). If PostgreSQL is unavailable the routes answer 500
`INTERNAL` and nothing is partially written, because each operation is a single statement. Volumetric
attacks are handled at the hosting edge. The absence of a per-user account cap and of a write-rate limit is
a human decision, recorded as accepted risk R-15.
