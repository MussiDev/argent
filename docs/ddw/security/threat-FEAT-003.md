# Threat model FEAT-003: Available balance vs net worth

| Field | Value |
|-------|-------|
| Ticket | FEAT-003 |
| Spec | docs/ddw/specs/spec-FEAT-003.md |
| Tier | FEATURE |
| Date | 2026-10-02 |

## Components
| Component | Source in the spec |
|---|---|
| `packages/shared/src/accounts/account.ts` | Block 1 |
| `apps/api/drizzle/0011_account_include_in_available.sql` | Block 2 |
| `apps/api/src/accounts/application/set-include-in-available.ts` | Block 3 |
| `apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts` | Block 4 |
| `apps/api/src/accounts/infrastructure/http/account-routes.ts` | Block 5 |
| `apps/api/src/shared/http/error-handler.ts` | Block 5 |
| `apps/web/src/lib/api-client.ts` | Block 6 |
| `apps/web/src/features/accounts/containers/accounts-container.tsx` | Block 7 |

## Trust boundaries
- Browser → API: `PUT /accounts/:id/include-in-available`, `POST /accounts` and `GET /accounts` carry the account id, the boolean setting and the financial totals over the public internet, behind the session cookie, the verified-email guard and the origin guard.
- API → database: the repository's conditional `UPDATE` and the `listActive` read cross into PostgreSQL with user-scoped statements.
- Migration runner → database: `0011_account_include_in_available.sql` runs with schema-owner rights during deployment.
- Web client → API response: the headline and the Debt section render the three totals maps returned by `GET /accounts`.

## STRIDE analysis
### `packages/shared/src/accounts/account.ts`
- **Spoofing:** the contracts carry no identity; the caller is identified by the session in Block 5, so there is nothing to spoof here.
- **Tampering:** a client could send `includeInAvailable: true` for a credit card or a string instead of a boolean; the strict boolean schema and the credit card refinement fail the request with a 400 naming the field.
- **Repudiation:** the schemas do not change state; the audit line is written by the route (R-04).
- **Information Disclosure:** validation errors name the field path only and never echo the submitted value, as in the 02a contracts.
- **Denial of Service:** the added fields are a boolean and three fixed-key maps; parsing cost does not grow with user input.
- **Elevation of Privilege:** `includeInAvailable` on the rename body fails as an invalid field, so rename cannot be used to bypass the card and archived rules of the dedicated route (R-02).

### `apps/api/drizzle/0011_account_include_in_available.sql`
- **Spoofing:** the migration runs under the deployment's own database credentials; no end-user identity is involved.
- **Tampering:** a half-applied migration could leave rows without a value or a card marked included; the statements run in one transaction, the column ends NOT NULL and the CHECK `accounts_credit_card_not_available_check` rejects a card marked included (R-03).
- **Repudiation:** the applied migration is recorded in the drizzle journal table with its `when`; the rollback script forgets that row explicitly.
- **Information Disclosure:** the script touches one boolean column and no personal data; it logs nothing about row contents.
- **Denial of Service:** the backfill is a single UPDATE over the accounts table, which is small at personal scale; the column default is added and dropped without rewriting rows twice.
- **Elevation of Privilege:** the script grants no rights and adds no function or trigger; the existing immutability trigger on type, currency and owner is untouched.

### `apps/api/src/accounts/application/set-include-in-available.ts`
- **Spoofing:** the use case receives only an `AccessScope<'write'>` built from the authenticated session, never a raw user id.
- **Tampering:** the setting changes only through the repository's conditional update, so name, type, currency and balance cannot change in this path.
- **Repudiation:** the route logs the change with user id and account id (R-04); the use case itself is pure and testable.
- **Information Disclosure:** `not_found` is returned identically for a missing and a foreign id, so the response never reveals that another user's account exists (R-01).
- **Denial of Service:** one indexed locked read and at most one UPDATE per request; the existing write-rate decision of 02a (no extra limit, cost bounded by indexes) applies unchanged.
- **Elevation of Privilege:** the card rule is checked before the archived rule and both before any write, so a card can never be made available and an archived account cannot be edited (R-02).

### `apps/api/src/accounts/infrastructure/db/drizzle-account-repository.ts`
- **Spoofing:** every method requires an `AccessScope` and filters with `scopedTo` in the same statement.
- **Tampering:** the method reads the scoped row `FOR UPDATE` and writes in the same transaction, only for an active non-card row, and sets only `include_in_available` and `updated_at`, so a concurrent archive cannot be overwritten (R-05).
- **Repudiation:** `updated_at` is stamped by the database clock, giving a trustworthy last-change time.
- **Information Disclosure:** the locked read that classifies the row uses `scopedRow`, the same scope condition as every other statement, so it cannot read another owner's row (R-01).
- **Denial of Service:** the row lock is held for one short transaction and only on the caller's own row, so it cannot block other users; `listActive` loads all active accounts of the owner once for three totals; it adds two columns and no second query, and the 100-account, 100,000-movement perf test keeps the 300 ms p95 budget.
- **Elevation of Privilege:** no method accepts a raw owner id; statements are built with Drizzle parameters, never string concatenation.

### `apps/api/src/accounts/infrastructure/http/account-routes.ts`
- **Spoofing:** the route sits behind `requireSession`, `requireVerifiedEmail` and the origin guard with the `X-Requested-With` header, so a cross-site form cannot forge the request.
- **Tampering:** params and body are validated with the shared schemas through `validate`; handlers never read `req.body` raw.
- **Repudiation:** the route writes an audit line with user id, account id and the new boolean only (R-04).
- **Information Disclosure:** responses are parsed by the response schema, which strips undeclared fields; errors carry a code and field paths, never values, names or amounts.
- **Denial of Service:** the new route is one short scoped transaction; the session and rate controls already in front of `/accounts` apply.
- **Elevation of Privilege:** another user's account answers 404, the same body as a missing id; a card answers 400 and an archived account 409, so the route cannot be used to probe or change data outside the caller's scope (R-01, R-02).

### `apps/web/src/lib/api-client.ts`
- **Spoofing:** the client relies on the session cookie and the existing origin header; it holds no credential of its own.
- **Tampering:** the client builds the body from a boolean parameter, and `onAccount` refuses ids that are not a plain path segment, so the id cannot rewrite the request path.
- **Repudiation:** the client records nothing; the server audit line is the record.
- **Information Disclosure:** failures map to message keys only; no server detail reaches the screen.
- **Denial of Service:** one request per toggle; the container disables the row controls while a request is in flight.
- **Elevation of Privilege:** the client cannot grant itself anything; the server decides on the session scope for every call.

### `apps/web/src/features/accounts/containers/accounts-container.tsx`
- **Spoofing:** the container never reads or sets identity; a 401 sends the user to sign-in.
- **Tampering:** the toggle updates the row from the API response and reloads the totals, so a failed request never leaves a client-side value that disagrees with the server (R-06).
- **Repudiation:** the container shows the outcome of each toggle (success or the alert), so the user can tell what happened.
- **Information Disclosure:** amounts are rendered with the locale formatter from the API's decimal strings; nothing is written to storage, logs or the URL.
- **Denial of Service:** a toggle triggers one write and one silent list reload; there is no polling.
- **Elevation of Privilege:** the checkbox is hidden for cards and archived accounts for clarity only; the server enforces both rules regardless of what the page shows (R-02).

### `apps/api/src/shared/http/error-handler.ts`
- **Spoofing:** the handler maps errors to responses and identifies nobody; callers are authenticated earlier in the chain.
- **Tampering:** it now emits the `fields` list an `AppError` carries; the list is fixed text declared by the domain error (`body.includeInAvailable`), never built from request data.
- **Repudiation:** each rejected request is logged with request id, route, status and code, as before.
- **Information Disclosure:** the body carries a code and field paths only; stack traces and driver messages stay in the log, and a field path never contains a submitted value.
- **Denial of Service:** mapping is constant time and adds one optional array to the body.
- **Elevation of Privilege:** an unknown code still maps to 500 `INTERNAL`; adding `ACCOUNT_ARCHIVED: 409` to the exhaustive status record grants nothing.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| `include_in_available` (per account) | financial (a preference over the user's own accounts) | PostgreSQL boolean, NOT NULL, owner-scoped, covered by the database's encrypted volume and backups | TLS 1.3 between browser and API, TLS to the database |
| availableTotals, netWorthTotals, debtTotals | financial | derived on read, never stored | TLS 1.3, decimal strings in JSON, same cache behaviour as the existing account list |
| account id in the route path | public identifier (random UUID, access still owner-scoped) | PostgreSQL uuid primary key | TLS 1.3 |
| audit log line (user id, account id, boolean) | financial metadata, no name and no amount | application log store, retention as for other audit lines | TLS to the log sink |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A user reads or changes another user's account setting, or learns it exists | I | M | H | every repository statement is filtered by `scopedTo`; foreign and missing ids both answer 404 with the same body; tests AC-22 and NFR-04 |
| R-02 | A credit card is marked as available, or an archived account is edited, by calling PATCH, POST or PUT with crafted bodies | E | M | M | card rule and archived rule enforced in the use case and in the UPDATE's WHERE clause; the CHECK `accounts_credit_card_not_available_check` is the database backstop; PATCH rejects the field; tests AC-10, AC-11, AC-12 |
| R-03 | The migration leaves accounts without a value or with a card marked included, silently changing the headline | T | L | H | one transaction, backfill by type default, NOT NULL after the backfill, CHECK added last; migration test AC-21 and a forced-failure rollback test; documented rollback script |
| R-04 | A setting change cannot be attributed to a user afterwards | R | L | M | the route writes an audit line with user id, account id and boolean; no name and no amount are logged; test on the audit line (NFR-04) |
| R-05 | A race between archive and the setting change updates an archived account | T | L | L | read `FOR UPDATE` and write in one transaction, update only an active non-card row; repository test AC-12 |
| R-06 | The page shows a setting or total that disagrees with the server after a failed or partial update | T | M | L | the row is updated from the API response only and totals are reloaded after each action; failure keeps the previous value and shows the alert; tests in Block 7 |
| R-07 | Totals overflow or throw for very large balances and take the list down | D | L | M | exact `bigint` arithmetic through `sumExact`, unbounded integer-string response schemas; test with 9,300 accounts at 10^15 (AC-17, NFR-01) |

## Supply chain
No new runtime or development dependency is added: the setting control is a native checkbox styled with theme tokens, the route reuses Express, Zod and Drizzle already in the lockfile, and the migration is plain SQL. `pnpm audit --prod --audit-level high` stays unchanged and runs in CI.

## Availability
The new route is one indexed UPDATE per request behind the session guards, and the list adds two columns to the query it already ran, so it creates no new amplification vector. The list budget of 300 ms p95 at 100 accounts and 100,000 movements is re-tested with the three totals (NFR-02). The migration is a single UPDATE on a small table and needs no downtime beyond the deploy's normal migration step.
