# Threat model DISC-001-03b: Expense and Income

| Field | Value |
|-------|-------|
| Ticket | DISC-001-03b |
| Spec | docs/ddw/specs/spec-DISC-001-03b.md |
| Tier | FEATURE |
| Date | 2026-10-02 |

Risk identifiers are local to this ticket (R-01 to R-16).

## Components
| Component | Source in the spec |
|---|---|
| `packages/shared/src/movements/movement.ts` + `packages/shared/src/movements/rate-age.ts` + `packages/shared/src/time/today.ts` (request and response contracts, rate age, today in a time zone) | Block 1 |
| `apps/api/src/movements/application/create-movement.ts` + `apps/api/src/movements/application/list-movements.ts` + `apps/api/src/movements/application/get-movement.ts` + `apps/api/src/movements/domain/errors.ts` (use cases and typed errors) | Block 2 |
| `apps/api/src/movements/infrastructure/db/schema.ts` + `apps/api/drizzle/0013_movements.sql` (`movements` relation, composite keys, checks, unique constraint on accounts) + `apps/api/drizzle/rollback/0013_movements.down.sql` | Block 3 |
| `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts` + `apps/api/src/movements/infrastructure/db/drizzle-account-lookup.ts` + `apps/api/src/movements/infrastructure/db/drizzle-category-lookup.ts` + `apps/api/src/movements/infrastructure/db/drizzle-rate-lookup.ts` + `apps/api/src/movements/infrastructure/db/drizzle-user-preferences.ts` | Block 3 and Block 4 |
| `apps/api/src/movements/infrastructure/accounts/drizzle-account-movements.ts` + `apps/api/src/movements/infrastructure/categories/drizzle-category-usage.ts` (the real adapters of the two open ports) | Block 4 |
| `apps/api/src/movements/infrastructure/http/movement-routes.ts` + `apps/api/src/movements/infrastructure/http/movement-presenter.ts` (`POST /movements`, `GET /movements`, `GET /movements/:id`) + `apps/api/src/server.ts` wiring | Block 5 |
| `apps/api/src/identity/infrastructure/db/user-erasure-step.ts` + `apps/api/src/identity/infrastructure/db/drizzle-user-deletion-repository.ts` + `apps/api/src/movements/infrastructure/db/erase-user-movements.ts` (ordered erasure step) + `apps/api/test/identity/user-erasure.test.ts` (guard policy `erase-step`) | Block 6 |
| `apps/web/src/features/movements/containers/create-movement-container.tsx` + `apps/web/src/features/movements/containers/movements-container.tsx` + `apps/web/src/features/movements/components/movement-form.tsx` + `apps/web/src/features/movements/components/movement-list.tsx` + `apps/web/src/lib/api-client.ts` (web client and screens) | Block 8 and Block 9 |

## Trust boundaries
- Browser → API (Express): public internet; movement amounts, dates, notes and rate choices go up, movements and balances come down, session cookies, all over TLS; the origin guard and `X-Requested-With: argent` protect state-changing routes.
- API (movements routes) → movements application layer: the authenticated user id and the `AccessScope` issued by the `AccessPolicy` cross here; the body has already been parsed by the shared Zod schemas.
- Movements application layer → PostgreSQL: private network; owner-scoped `movements` rows plus point reads of accounts, categories, `users` preferences and `exchange_rates`.
- Accounts and categories modules → the real `AccountMovements` and `CategoryUsage` adapters: the unscoped boundary; only ids that the scoped repositories already returned cross it, and sums come back.
- Identity deletion transaction → the erasure step injected by the composition root: identity runs code it does not know inside its transaction, with the user id and the transaction handle.
- Web containers → presentational components: notes and names reach the DOM only through React's escaping.

## STRIDE analysis
### `packages/shared/src/movements/movement.ts` + `packages/shared/src/movements/rate-age.ts` + `packages/shared/src/time/today.ts` (request and response contracts, rate age, today in a time zone)
- **Spoofing:** the contract carries no user id or owner; the owner is taken from the session, so a client cannot name another owner (R-01, R-04).
- **Tampering:** amounts are integer strings within 1..10^15 and rates are scaled strings within the range, parsed to bigint, so floats, exponents and decimals are refused; unknown keys are stripped, so `owner_id`, `id` or `created_at` cannot be mass-assigned (R-03, R-04).
- **Repudiation:** none; pure functions with no side effects.
- **Information Disclosure:** validation failures list field paths only, never the submitted values; the response schema strips undeclared fields.
- **Denial of Service:** `limit` is capped at 100, the note at 500 characters, the amount string is short, and the 16 kb body limit applies (R-08).
- **Elevation of Privilege:** nothing in the contracts grants a role or an access level.

### `apps/api/src/movements/application/create-movement.ts` + `apps/api/src/movements/application/list-movements.ts` + `apps/api/src/movements/application/get-movement.ts` + `apps/api/src/movements/domain/errors.ts` (use cases and typed errors)
- **Spoofing:** every operation receives an `AccessScope` issued from the session's `AuthContext`; use cases never read a user id from input (R-01).
- **Tampering:** the category kind must equal the movement type and the account must be in the caller's scope before anything is stored; an automatic rate is resolved by the server from the stored rates, so the label "automatic" is never a client claim (R-02).
- **Repudiation:** create emits an audit log line with request id, user id and movement id only (R-06).
- **Information Disclosure:** an account, category or movement of another user answers exactly like a missing one, so existence is never confirmed (R-05).
- **Denial of Service:** a create is one insert plus four indexed point reads and a list is one paged query with a count, with no provider call (R-08, R-11).
- **Elevation of Privilege:** a write needs `AccessScope<'write'>`, a type only the policy can issue; group access is denied until PRD 05 (R-01).

### `apps/api/src/movements/infrastructure/db/schema.ts` + `apps/api/drizzle/0013_movements.sql` (`movements` relation, composite keys, checks, unique constraint on accounts) + `apps/api/drizzle/rollback/0013_movements.down.sql`
- **Spoofing:** `owner_id` is `NOT NULL` with a foreign key to `users` and the composite key `(account_id, owner_id)` to accounts, so a movement cannot reference another owner's account even if the application is bypassed (R-01).
- **Tampering:** check constraints bound the amount, the rate, the type, the note length and the pairing of rate source and rate type; the composite key `(category_id, owner_id, type)` makes the database refuse a category of the other kind (R-02, R-03).
- **Repudiation:** `created_at` and `updated_at` are set by the database.
- **Information Disclosure:** rows hold financial data and free-text notes, reachable only through the scoped repository; the database volume is encrypted at rest (R-05).
- **Denial of Service:** the list index `(owner_id, occurred_on, created_at, id)` and the account and category indexes keep every query indexed; adding the unique constraint to accounts is a short metadata-level change on a small relation (R-08, R-15).
- **Elevation of Privilege:** the rollback script is destructive and run by an operator with database access, never by the application, and says so in its header (R-15).

### `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts` + `apps/api/src/movements/infrastructure/db/drizzle-account-lookup.ts` + `apps/api/src/movements/infrastructure/db/drizzle-category-lookup.ts` + `apps/api/src/movements/infrastructure/db/drizzle-rate-lookup.ts` + `apps/api/src/movements/infrastructure/db/drizzle-user-preferences.ts`
- **Spoofing:** the owner is forced from the scope on insert and every read applies `scopedTo(scope, { owner })` in the same statement (R-01, R-16).
- **Tampering:** all values are bound parameters; dates and amounts travel as strings and bigint, never concatenated into SQL.
- **Repudiation:** timestamps come from the database or the injected clock.
- **Information Disclosure:** lookups return only the columns the use case needs (id, kind, archived state, rate, time zone, rate type).
- **Denial of Service:** list, count and point reads are indexed; the rate and preference reads are single-row.
- **Elevation of Privilege:** the rate lookup only reads `exchange_rates` and the preference lookup only reads two columns of the caller's own `users` row.

### `apps/api/src/movements/infrastructure/accounts/drizzle-account-movements.ts` + `apps/api/src/movements/infrastructure/categories/drizzle-category-usage.ts` (the real adapters of the two open ports)
- **Spoofing:** the adapters take no scope and trust the ids they receive; this is safe only because the accounts and categories modules pass ids returned by their scoped repositories, which the ports document and the tests exercise (R-13).
- **Tampering:** read-only queries; sums are exact bigint values (income positive, expense negative) with no float.
- **Repudiation:** none; no state is written.
- **Information Disclosure:** every result is keyed by the given ids and never reads another account's rows, so another user's movements cannot change a caller's balance (R-13).
- **Denial of Service:** one grouped query per chunk of at most 500 ids on `movements_account_idx`; the performance test covers 100 accounts and 100,000 movements (R-08).
- **Elevation of Privilege:** the adapters cannot write, and no route calls them with request-supplied ids.

### `apps/api/src/movements/infrastructure/http/movement-routes.ts` + `apps/api/src/movements/infrastructure/http/movement-presenter.ts` (`POST /movements`, `GET /movements`, `GET /movements/:id`) + `apps/api/src/server.ts` wiring
- **Spoofing:** all routes sit behind `requireSession` and `requireVerifiedEmail`; with no valid session the answer is 401 and no movement is returned (R-01).
- **Tampering:** params, query and body go through the shared schemas with unknown keys stripped; the origin guard refuses a state-changing request without the web origin headers (R-04, R-16).
- **Repudiation:** the shared request log records route, status and request id; the audit line carries ids only (R-06).
- **Information Disclosure:** errors answer `{ code }` (plus field paths) with no SQL or stack; another user's movement answers 404, never 403 (R-05).
- **Denial of Service:** the 16 kb body limit, the 100-item page cap and the session gates bound the cost of a request; there is no per-user write limiter (R-08).
- **Elevation of Privilege:** the owner always comes from the session; no route accepts an owner or group id.

### `apps/api/src/identity/infrastructure/db/user-erasure-step.ts` + `apps/api/src/identity/infrastructure/db/drizzle-user-deletion-repository.ts` + `apps/api/src/movements/infrastructure/db/erase-user-movements.ts` (ordered erasure step) + `apps/api/test/identity/user-erasure.test.ts` (guard policy `erase-step`)
- **Spoofing:** the step receives the user id of the deletion in progress from the repository, never from request input.
- **Tampering:** the step runs inside the deletion transaction, so a failure rolls back the user, the accounts and the movements together and no half-erased state is committed (R-10).
- **Repudiation:** the deletion keeps its existing audit trail; the guard test fails if a table of user data is not registered with a policy (R-09).
- **Information Disclosure:** erasing the movements first, then the user, leaves no financial rows of a deleted user; a retained movement would be personal data kept after deletion (R-09).
- **Denial of Service:** the step is one indexed delete by owner inside the existing `lock_timeout` of 5 seconds, so a stuck lock aborts the deletion instead of holding a connection.
- **Elevation of Privilege:** identity runs steps it is given and imports nothing from movements; only the composition root wires them, as with `seedDefaultCategories`.

### `apps/web/src/features/movements/containers/create-movement-container.tsx` + `apps/web/src/features/movements/containers/movements-container.tsx` + `apps/web/src/features/movements/components/movement-form.tsx` + `apps/web/src/features/movements/components/movement-list.tsx` + `apps/web/src/lib/api-client.ts` (web client and screens)
- **Spoofing:** the client sends only what the user typed; identity and ownership are decided by the server from the session cookie (R-01).
- **Tampering:** client validation is a convenience; the server re-validates everything, so a modified client gains nothing (R-02).
- **Repudiation:** none beyond the server's audit lines.
- **Information Disclosure:** notes, category and account names render only as React text nodes, never as HTML, and the control-character rule keeps hidden text out of notes (R-07).
- **Denial of Service:** the list loads pages of at most 100 and the screen makes a bounded number of requests.
- **Elevation of Privilege:** the web app holds no secret and no role; a 401 redirects to sign in.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Movement amount, date, account and category ids, frozen rate and its source | financial | PostgreSQL volume encrypted at rest; rows only reachable through the owner-scoped repository | TLS (production HTTPS guard) |
| Movement note (free text) | PII | PostgreSQL volume encrypted at rest; at most 500 characters, no control characters | TLS |
| Account and category names shown next to movements | PII | PostgreSQL volume encrypted at rest | TLS |
| User time zone and default rate type read for a save | PII | PostgreSQL volume encrypted at rest; read from the caller's own row only | private database network |
| Stored exchange rates | public | PostgreSQL volume encrypted at rest | private database network |
| Session cookie and access token presented to the routes | credentials | not stored by this module; the identity module stores them hashed | TLS, cookies flagged Secure in production |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A user reads or writes another user's movements, or records one on another user's account (object-level authorization) | S | M | H | Owner forced from the scope on insert, `scopedTo` in the same statement on every read, 404 for foreign ids, and the composite key `(account_id, owner_id)` repeats the check in the database; tests on every route |
| R-02 | A client forges the rate or its source, or records a category of the wrong kind | T | M | M | The automatic rate is resolved on the server from the stored rates, manual rates are bounded 1..RATE_MAX_SCALED, source and type are paired by a check constraint, and the category kind equals the type through the composite key |
| R-03 | Money or rate precision loss or overflow through floats or sums | T | M | H | bigint columns with range checks (amount 1..10^15, rate scaled), int64 strings on the wire, exact bigint sums, a static no-float scan and a schema-introspection test |
| R-04 | Mass assignment of owner, id or timestamps through the body | E | M | H | Shared schemas strip unknown keys, the owner comes from the session, and the response is built field by field |
| R-05 | Existence of other users' data leaks through error differences or messages | I | M | M | Foreign and missing ids answer the same 404, errors carry `{ code }` only, no SQL or stack in the body |
| R-06 | Amounts, notes or rates written to logs | I | L | M | Audit lines carry request id, user id and movement id only; a test asserts the log keys |
| R-07 | Stored XSS or hidden text through the note, account or category names | T | M | M | Names and notes render as React text nodes, the note refuses control and format characters and is capped at 500 characters |
| R-08 | Denial of service through heavy lists, unbounded growth or slow balance sums | D | M | M | Page cap of 100, indexed queries, sums in chunks of 500 on `movements_account_idx`, performance tests at 100,000 movements, body limit 16 kb; no per-user write limiter or cap is added (as for accounts in DISC-001-02a), growth per user is bounded by authenticated, verified-email access and the platform's edge limits, and the open question for the human is whether a per-user write limit is wanted |
| R-09 | A deleted user's movements remain (financial and personal data kept after deletion) | I | M | H | Ordered erasure step deleting the movements first in the deletion transaction after a `for update` lock on the user row, the guard policy `erase-step` tied to the named constraints with a test that the step removed the rows, and tests of the deterministic facts that record, without pinning, the order-dependent outcome of a bare user delete |
| R-10 | A half-completed deletion, or a movement created while the user is being deleted | T | L | H | The step runs in the same transaction as the user delete and a failure rolls everything back; the deletion takes `for update` on the user row before the step, so a concurrent insert, which needs a key-share lock on that row, waits and then fails on the foreign key after the user is gone; a race test covers it |
| R-11 | A wrong or missing rate is frozen without the user noticing | T | M | M | No stored rate answers `RATE_REQUIRED` and forces a manual rate (human decision), the entry screen shows the rate and its age when older than 2 hours, and the rate is editable before saving |
| R-12 | Movements recorded on an archived account or category | T | L | L | Open question Q2 for the human: the pickers hide archived items and the API accepts them unless the human decides otherwise; the data stays consistent because the keys still hold |
| R-13 | The unscoped adapters are asked about ids the caller does not own | I | L | H | The accounts and categories modules pass only ids returned by their scoped repositories (documented on the ports), every result is keyed by the given ids, and no route passes request-supplied ids to an adapter; tests cover another user's movements not affecting balances |
| R-14 | A future-dated movement slips through by manipulating the date or the time zone | T | L | L | The date is checked on the server against today in the user's stored time zone (a validated IANA zone), never against the client's clock |
| R-15 | The migration locks or corrupts accounts, or the rollback destroys data | D | L | H | The unique constraint on accounts is added in one short statement on a small relation, the migration is non-destructive and tested, and the destructive rollback is documented, needs a backup and a stopped API and worker |
| R-16 | Cross-site request forgery on `POST /movements` | S | L | M | The global origin guard requires the web origin and `X-Requested-With: argent` on state-changing routes; a test asserts 403 without them |

## Supply chain
No new runtime dependency is planned: the module uses the already installed `drizzle-orm`, `pg`, `zod` and Express, and the web part uses the existing React, next-intl, Tailwind and shadcn components. The only external service involved is none: the module reads the rates already stored by DISC-001-03a and never calls dolarapi.com.

## Availability
The save path has one insert and four indexed point reads and no external call, so it stays up when the rate provider is down (a missing stored rate only forces a manual rate). The real balance adapter adds one grouped query per account list, covered by a performance test at 100 accounts and 100,000 movements. Deletion of a user stays one transaction with a 5-second lock timeout. The rollback of migration 0013 is destructive and is an operator action with the API and the worker stopped.
