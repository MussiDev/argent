# Threat model DISC-001-07a: Portfolios, Holdings and Manual Valuation

| Field | Value |
|-------|-------|
| Ticket | DISC-001-07a |
| Spec | docs/ddw/specs/spec-DISC-001-07a.md |
| Tier | FEATURE |
| Date | 2026-10-01 |

## Components
| Component | Source in the spec |
|---|---|
| `packages/shared/src/investments/contracts.ts` + `valuation.ts` + `decimal.ts` | Block 1 |
| `apps/api/src/investments/domain/holding.ts` (`mergeHoldings`, `applyHoldingEdit`) | Block 2 |
| `apps/api/src/investments/application/holding-use-cases.ts` + `portfolio-use-cases.ts` | Block 3 |
| `apps/api/src/investments/infrastructure/db/schema.ts` (`portfolios`, `holdings`) + `apps/api/drizzle/0005_investments.sql` | Block 4 |
| `apps/api/src/investments/infrastructure/db/drizzle-portfolio-repository.ts` + `drizzle-holding-repository.ts` + `drizzle-unit-of-work.ts` | Block 4 |
| `apps/api/src/investments/infrastructure/http/portfolio-routes.ts` (`GET`/`POST`/`DELETE /investments/portfolios`) | Block 5 |
| `apps/api/src/shared/http/error-handler.ts` (adds `fields` to the body of an `AppError` that carries them) | Block 5 |
| `apps/api/src/investments/infrastructure/http/holding-routes.ts` (`POST /investments/portfolios/:portfolioId/holdings`, `GET`/`PATCH`/`DELETE /investments/holdings/:holdingId`, `PUT /investments/holdings/:holdingId/price`) | Block 6 |
| `apps/web/src/lib/api-client.ts` + `apps/web/src/features/investments/**` (containers, components, forms) | Blocks 7 to 10 |

## Trust boundaries
- Browser → API (Express): public internet; JSON bodies with portfolio and holding data, the session cookies, and the `X-Requested-With` header travel over TLS to `/investments/*`.
- API HTTP layer → application use cases: the validated, typed input crosses from untrusted request data into trusted domain code; the user id comes only from `req.auth`.
- Application → PostgreSQL: private network; every statement carries the `AccessScope` of the caller, and values are bound parameters.
- API → browser (responses): financial data leaves the system; only the caller's own rows are returned, serialized through the response contracts.
- Web client → rendered page: user-entered text (portfolio name, ticker, instrument name) is rendered back into the DOM inside the web origin.

## STRIDE analysis
### `packages/shared/src/investments/contracts.ts` + `valuation.ts` + `decimal.ts`
- **Spoofing:** not applicable to pure contracts and arithmetic; identity is established by the session middleware before any contract is parsed.
- **Tampering:** amounts and quantities are accepted only as integer strings within fixed bounds (quantity up to 10^18, total cost up to 10^15, unit price up to 10^12), so a crafted value cannot overflow `bigint` or smuggle a float (R-05, R-06).
- **Repudiation:** not applicable; the helpers have no side effects and keep no state.
- **Information Disclosure:** validation errors list failing field paths, never the submitted values (existing `validate` behavior); unknown keys are stripped, so a body cannot reach fields the contract does not name (R-02).
- **Denial of Service:** `parseScaledDecimal` is linear in the length of a field capped by the contract; no regular expression with nested quantifiers is used.
- **Elevation of Privilege:** the request contracts contain no `ownerId` or `userId` field, so ownership cannot be set from input (R-02).

### `apps/api/src/investments/domain/holding.ts` (`mergeHoldings`, `applyHoldingEdit`)
- **Spoofing:** not applicable; the domain receives no identity.
- **Tampering:** a merge across valuation currencies is rejected before any value is combined, so a holding in USD can never absorb pesos as if they were dollars (R-08); merged sums above the limits are rejected instead of wrapping (R-05).
- **Repudiation:** not applicable in the domain; the HTTP layer records the mutation (R-15).
- **Information Disclosure:** violations carry only a field name, not the stored values.
- **Denial of Service:** pure O(1) functions over two records.
- **Elevation of Privilege:** `assertCryptoInUsd` runs on create and on edit, so the crypto currency rule (FR-14) cannot be bypassed by editing after creation.

### `apps/api/src/investments/application/holding-use-cases.ts` + `portfolio-use-cases.ts`
- **Spoofing:** every use case receives an `AccessScope` issued by the policy from the authenticated session; a scope cannot be fabricated because its constructor is private (existing `access-policy.ts`).
- **Tampering:** adding or merging a holding runs in one transaction that locks the portfolio row, so two concurrent adds of the same ticker cannot create duplicates or lose an update (R-07).
- **Repudiation:** use cases return the resulting records so the HTTP layer can log the action with ids (R-15).
- **Information Disclosure:** a missing and a foreign row are the same `ResourceNotFound`, so a caller cannot probe other users' ids (R-01).
- **Denial of Service:** list reads are two indexed statements; there is no per-user cap on portfolios or holdings (R-12).
- **Elevation of Privilege:** writes require `AccessScope<'write'>` in their signatures, so a read scope cannot update or delete; this is a compile-time guarantee (R-01).

### `apps/api/src/investments/infrastructure/db/schema.ts` (`portfolios`, `holdings`) + `apps/api/drizzle/0005_investments.sql`
- **Spoofing:** not applicable to storage.
- **Tampering:** a composite foreign key `(portfolio_id, owner_id)` makes it impossible to store a holding under a portfolio of another owner; check constraints bound quantity, cost, price and currency and enforce crypto in USD even if application code is bypassed (R-01, R-05).
- **Repudiation:** `created_at` is recorded on both tables; `priced_at` and `price_source` record when and how the latest price was set.
- **Information Disclosure:** the data is financial and stored in the application database, whose volume is encrypted with AES-256; no secret or credential is stored in these tables.
- **Denial of Service:** indexes on `owner_id` (both tables) and the unique index on `(portfolio_id, lower(ticker))` keep reads and the ticker lookup index-only; the rollback script exists so a bad migration can be reverted (R-12).
- **Elevation of Privilege:** the migration adds no role or grant; deleting a user cascades to portfolios and holdings so no orphaned financial data survives account deletion.

### `apps/api/src/investments/infrastructure/db/drizzle-portfolio-repository.ts` + `drizzle-holding-repository.ts` + `drizzle-unit-of-work.ts`
- **Spoofing:** not applicable; the scope is the only identity input and it is verified as issued by `assertIssuedScope`.
- **Tampering:** every statement is a single query with `scopedTo(scope, ...)` in its WHERE clause, so there is no check-then-act gap; all values are bound parameters, so a ticker such as `'; drop table` is data, never SQL (R-04).
- **Repudiation:** not applicable in repositories; they hold no audit state.
- **Information Disclosure:** repositories select only the columns the contracts need and return null for rows outside the scope.
- **Denial of Service:** `SELECT ... FOR UPDATE` locks one portfolio or holding row for the duration of a short transaction; there is no table lock.
- **Elevation of Privilege:** a repository method without a scope does not compile, and a scope forged by a cast or a spread copy throws before SQL is built (existing `assertIssuedScope`) (R-01).

### `apps/api/src/shared/http/error-handler.ts` (adds `fields` to the body of an `AppError` that carries them)
- **Spoofing:** not applicable; the handler runs after authentication and trusts nothing in the error.
- **Tampering:** the change only reads an optional list of strings from a typed error; a non-array or non-string value is ignored, so a crafted error cannot alter the response shape.
- **Repudiation:** the handler keeps logging every rejected request with request id, route, status and code (existing), so rejected holding changes stay traceable.
- **Information Disclosure:** `fields` holds failing paths such as `body.valuationCurrency`, never submitted values, and driver or stack text still goes only to the log (R-10).
- **Denial of Service:** one extra property read per error; no allocation proportional to input.
- **Elevation of Privilege:** the handler grants nothing; the status still comes from the fixed `STATUS_BY_CODE` map.

### `apps/api/src/investments/infrastructure/http/portfolio-routes.ts` (`GET`/`POST`/`DELETE /investments/portfolios`)
- **Spoofing:** `requireSession` authenticates the access-token cookie on every request against the live session row, so a revoked session stops working at once.
- **Tampering:** state-changing requests must come from the web origin with `X-Requested-With: argent` (origin guard) on top of `SameSite=Strict` cookies, which blocks cross-site forms (R-03); the body is parsed by the shared `validate` middleware.
- **Repudiation:** each successful create and delete is logged with request id, user id, action and portfolio id, and no amounts or names (R-15).
- **Information Disclosure:** foreign and missing portfolios both answer 404 `NOT_FOUND` with the same body; error bodies carry only a code; responses are parsed through the response contract, so undeclared fields cannot leak (R-01, R-10).
- **Denial of Service:** JSON bodies are capped by the existing body limit and the name is at most 60 characters; the routes are reachable only by verified-email users (R-12).
- **Elevation of Privilege:** `requireVerifiedEmail` runs after `requireSession`, and the user id is taken from `auth`, never from the body, params or query (R-14).

### `apps/api/src/investments/infrastructure/http/holding-routes.ts` (`POST /investments/portfolios/:portfolioId/holdings`, `GET`/`PATCH`/`DELETE /investments/holdings/:holdingId`, `PUT /investments/holdings/:holdingId/price`)
- **Spoofing:** same session and verified-email middleware as the portfolio routes.
- **Tampering:** the origin guard covers `POST`, `PATCH`, `PUT` and `DELETE`; a body with `ownerId`, `portfolioId` or `source` has the unknown keys stripped, and the price source is always set by the server to `manual` on this route (R-02, R-03).
- **Repudiation:** each add, merge, edit, price change and delete is logged with request id, user id, action and holding id, and no quantities, costs or prices (R-15).
- **Information Disclosure:** a merge rejected for a currency mismatch answers 400 with the field name only, which reveals nothing about other users; foreign holdings answer 404 (R-01, R-10).
- **Denial of Service:** one holding route performs at most one transaction with two row locks; the quantity and amount bounds keep arithmetic cheap (R-12).
- **Elevation of Privilege:** `PUT .../price` and `PATCH` require a write scope; adding to a portfolio checks that the portfolio is inside the caller's write scope before inserting (R-01).

### `apps/web/src/lib/api-client.ts` + `apps/web/src/features/investments/**` (containers, components, forms)
- **Spoofing:** the client sends credentials only to the configured API origin and refuses redirects, as the existing client does.
- **Tampering:** forms validate typed numbers locally, but the API validates again; the client never computes a value that is stored.
- **Repudiation:** not applicable; the browser keeps no audit state.
- **Information Disclosure:** amounts are shown only after an authenticated response; nothing financial is put in URLs, local storage or logs; Server Components never touch financial data (AGENTS.md) (R-11).
- **Denial of Service:** the list reloads once per mutation and not on a timer; the response is bounded by the user's own data (R-12).
- **Elevation of Privilege:** the web app trusts no role or id from the page; hiding a button grants nothing, since every route enforces the scope again (R-01).

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| portfolio name | financial | `portfolios.name` in PostgreSQL; database volume encrypted with AES-256; never logged | TLS 1.2+ |
| instrument ticker and name | financial | `holdings.ticker`, `holdings.instrument_name`; database volume encrypted with AES-256; never logged | TLS 1.2+ |
| quantity, total cost, unit price | financial | `bigint` columns in `holdings`; database volume encrypted with AES-256; never logged | TLS 1.2+ |
| computed value, gain or loss, totals | financial | never stored; computed on read | TLS 1.2+ |
| owner user id | PII | foreign key to `users.id`; database volume encrypted with AES-256; appears in logs only as an opaque id | TLS 1.2+ |
| price source and price date | public | `holdings.price_source`, `holdings.priced_at`; database volume encrypted with AES-256 | TLS 1.2+ |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A user reads, edits or deletes another user's portfolio or holding by guessing ids (IDOR) | E | M | H | `AccessScope` required by every repository method and placed in the WHERE clause of one statement; composite foreign key `(portfolio_id, owner_id)`; missing and foreign rows both answer 404; tests with two users on every route |
| R-02 | Mass assignment: a body sets `ownerId`, `portfolioId` or the price source | T | M | H | request contracts contain no such fields and strip unknown keys; owner comes from `auth`; the price source is set by the route |
| R-03 | Cross-site request forgery on create, edit, price and delete | T | L | H | existing origin guard (`Origin` and `X-Requested-With: argent`) on every non-safe method plus `SameSite=Strict` session cookies |
| R-04 | SQL injection through ticker, names or ids | T | L | H | Drizzle bound parameters only, UUID params, ticker pattern and length limits, check constraints; a repository test stores an injection-shaped portfolio name as plain data |
| R-05 | Integer overflow or `bigint` out-of-range errors from large quantities, costs, prices or repeated merges | T | M | M | bounds in contracts (10^18, 10^15, 10^12), the same bounds as check constraints, merge sums re-checked in the domain, valuation on `BigInt` in JavaScript, no `Number` conversion |
| R-06 | Floating-point error corrupts money, quantities or percentages | T | M | H | `BigInt` arithmetic only in `packages/shared/src/investments`; JSON carries decimal strings; a source-scan test forbids `parseFloat`, `Number(` and `toFixed`; the percentage is computed in basis points |
| R-07 | Concurrent adds of the same ticker create duplicate holdings or lose an update | T | M | M | transaction with a row lock on the portfolio, plus the unique index on `(portfolio_id, lower(ticker))` as the last line; a concurrency test |
| R-08 | A merge silently combines holdings of different currencies, producing a wrong cost and value | T | M | H | merge across valuation currencies is rejected with a validation error and nothing merged (conservative default, pending human confirmation recorded in the PRD) |
| R-09 | A stale or missing price is presented as current | I | M | M | every price carries source and time; the API returns `priceStale` after 7 days; holdings without price show no value and are excluded from totals and counted |
| R-10 | Errors reveal whether an id exists, or leak driver or stack text | I | M | M | one 404 body for missing and foreign rows; the single error middleware returns only a code; validation lists paths, never values; a test checks a 500 body has no driver text |
| R-11 | Stored XSS through portfolio name, ticker or instrument name rendered in the web app | T | L | H | React escaping with no raw HTML rendering, ticker pattern limited to letters, digits and `._/-`, length limits, the existing Content Security Policy |
| R-12 | Resource exhaustion by an authenticated user creating very many portfolios or holdings, or a very large list response | D | L | M | verified-email-only routes, body size limit, field length limits, indexed single-statement queries and a benchmark at 500 holdings (NFR-03); no per-user count cap is designed because the PRD states none, see the accepted risk below |
| R-13 | Deleting a portfolio destroys all its holdings by mistake | T | M | M | the screen asks a second confirmation before deleting a portfolio and states that its holdings are removed; deletion is the requirement of FR-13 |
| R-14 | An unverified or signed-out user reaches financial routes | E | L | H | `requireSession` then `requireVerifiedEmail` on every `/investments` route; tests for 401 and 403 |
| R-15 | A user denies having changed or deleted a holding, or support cannot trace a change | R | L | M | each successful mutation is logged with request id, user id, action and entity id; amounts, quantities and names are never logged |

## Accepted risks
### R-12
- **Accepted by:** project owner (user) — confirmation requested in the DISC-001-07a PLAN report of 2026-10-01 and not yet given.
- **Justification:** the PRD defines no limit on portfolios or holdings per user, and adding one would invent a requirement; the product has a handful of users, the routes need a verified account, and the list is bounded by NFR-03 testing at 500 holdings. A cap of 50 portfolios and 2,000 holdings per user is recommended if the owner prefers a guardrail.
- **Review conditions:** when the owner answers the question in the PLAN report, or before opening registration beyond a few hundred users, whichever comes first.

## Supply chain
No new runtime dependency: validation uses `zod` and the arithmetic uses the language's `BigInt`, both already in the lockfile; the type and currency pickers are a native `select`, so no Radix package is added. The module calls no external service in this ticket; the crypto price provider (CoinGecko) and the broker import come in DISC-001-07b and DISC-001-07c behind their own adapters.

## Availability
The new routes are plain authenticated reads and short transactions over indexed tables. A lock is held on one portfolio row only while a holding is added, so concurrent users never block each other. If PostgreSQL is unavailable the routes answer 500 `INTERNAL` and nothing partial is written, because each mutation is a single statement or one transaction. Volumetric attacks are handled at the hosting edge; per-user volume is the accepted risk R-12.
