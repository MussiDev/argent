# Spec DISC-001-07a: Portfolios, Holdings and Manual Valuation

| Field | Value |
|-------|-------|
| Ticket | DISC-001-07a |
| PRD | docs/ddw/prd/prd-DISC-001-07a.md |
| Tier | FEATURE |
| Date | 2026-10-01 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
Adds the `investments` module to the API (hexagonal: `domain/`, `application/`, `infrastructure/`)
and an Investments screen to the web app. A user owns portfolios; a portfolio owns holdings (one
per instrument ticker, unique ignoring case). Quantities are 64-bit integers scaled by 10^8,
amounts are 64-bit integers in minor units, and both travel in JSON as decimal strings, never as
floats. Value, gain or loss, totals, the "without price" count and the stale-price flag are computed
on read by pure helpers in `packages/shared`; nothing derived is stored. Prices are stored on the
holding (latest only: unit price, source, timestamp). Every repository method requires an
`AccessScope` from the existing `AccessPolicy`, so another user's rows answer 404. Adding a
holding whose ticker already exists merges into it inside one transaction that locks the portfolio
row. Block 1 builds the shared contracts and arithmetic; Blocks 2-3 the domain rules and use cases;
Block 4 the persistence (migration `0008_investments`); Blocks 5-6 the HTTP routes; Blocks 7-10 the
web client, components, forms and screen; Block 11 the NFR-03 benchmark and an end-to-end flow. No
new runtime dependency is added: the type and currency pickers are a native `select` styled with
theme tokens, so no Radix package is needed.

Design choices the PRD leaves to the spec (all technical, none changes a user-visible rule the PRD
states; confirmed by the human on 2026-10-01): the latest price only is stored, not a price history (FR-07 asks for source and time of
"every unit price" as it is set, and only the latest is ever shown or used); a total cost must be
greater than 0 when present; changing the valuation currency requires the request to state the
total cost again (a value or an explicit null), because the old cost is in the old currency (FR-17);
value is rounded half up to the minor unit and the gain percentage is shown with 2 decimals,
computed in basis points with half away from zero rounding; a holding's price is stale when more
than 7 x 24 hours have passed since it was set.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 3, Block 4, Block 5, Block 7, Block 9, Block 10, Block 11 |
| FR-02 | Block 1, Block 2, Block 3, Block 4, Block 6, Block 9 |
| FR-03 | Block 1, Block 4, Block 9 |
| FR-04 | Block 1, Block 2, Block 3, Block 4, Block 6, Block 9 |
| FR-05 | Block 3, Block 4, Block 6, Block 10 |
| FR-06 | Block 1, Block 3, Block 4, Block 6, Block 9 |
| FR-07 | Block 3, Block 4, Block 6, Block 8 |
| FR-08 | Block 1, Block 3, Block 8 |
| FR-09 | Block 1, Block 3, Block 8 |
| FR-10 | Block 1, Block 3, Block 8 |
| FR-11 | Block 1, Block 3, Block 8 |
| FR-12 | Block 4, Block 5, Block 6 |
| FR-13 | Block 3, Block 4, Block 5, Block 10 |
| FR-14 | Block 1, Block 2, Block 4, Block 9 |
| FR-15 | Block 3, Block 8 |
| FR-16 | Block 3, Block 8 |
| FR-17 | Block 2, Block 3, Block 4, Block 6, Block 9 |
| FR-18 | Block 2, Block 3, Block 4, Block 6 |
| FR-19 | Block 2, Block 3, Block 6, Block 9 |
| FR-20 | Block 2, Block 3 |
| NFR-01 | Strategy: money columns are `bigint`, JSON carries decimal strings that the HTTP layer converts to `BigInt` at the boundary, and every multiplication, sum and percentage runs on `BigInt` inside `packages/shared/src/investments/valuation.ts`; a test scans the module sources for floating-point money arithmetic. |
| NFR-02 | Strategy: quantities are stored as `bigint` scaled by 10^8, entered as decimal text and converted to the scaled integer by `parseScaledDecimal` (string arithmetic, no `parseFloat`), and displayed with `formatScaledDecimal`; the same helpers serve API contracts and the web form. |
| NFR-03 | Strategy: one list call returns portfolios with their holdings and computed values using exactly two indexed SELECT statements (portfolios by owner, holdings by owner), all valuation is in-memory arithmetic on at most a few hundred rows, and Block 11 benchmarks 10 portfolios and 500 holdings and asserts p95 below 500 ms. |

## Dependencies between blocks
Block 2 depends on Block 1. Block 3 depends on Blocks 1 and 2. Block 4 depends on Blocks 1 and 2
(it implements the ports declared in Block 2) and can run in parallel with Block 3. Block 5 depends
on Blocks 3 and 4. Block 6 depends on Block 5. Block 7 depends on Block 1. Block 8 depends on
Block 7. Block 9 depends on Blocks 7 and 8. Block 10 depends on Blocks 8 and 9. Block 11 depends on
Blocks 6 and 10. Execution order: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11.

## Block 1 — Shared contracts, decimal helpers and valuation arithmetic

**Files**
- `packages/shared/src/investments/constants.ts` (new) — instrument types, valuation currencies, price sources, field limits.
- `packages/shared/src/investments/decimal.ts` (new) — `parseScaledDecimal`, `formatScaledDecimal`.
- `packages/shared/src/investments/valuation.ts` (new) — `holdingValue`, `gainOrLoss`, `isPriceStale`, `totalsByCurrency`.
- `packages/shared/src/investments/contracts.ts` (new) — Zod contracts for requests, params and responses.
- `packages/shared/src/index.ts` (modified) — exports the four modules above.

**Logic**
- Constants: `INSTRUMENT_TYPES = ['stock', 'cedear', 'bond', 'mutual_fund', 'fixed_term_deposit', 'crypto', 'other']` (FR-03), `VALUATION_CURRENCIES = ['ARS', 'USD']`, `PRICE_SOURCES = ['import', 'manual', 'automatic']` (FR-07), `QUANTITY_SCALE = 10^8`, `STALE_PRICE_AFTER_MS = 7 x 24 x 3,600,000`, limits: portfolio name 60 characters, ticker 20, instrument name 100, quantity at most 10^18 scaled units, total cost at most 10^15 minor units, unit price at most 10^12 minor units.
- `holdingValue(quantity, unitPrice)` returns `(quantity * unitPrice + QUANTITY_SCALE / 2) / QUANTITY_SCALE` on `BigInt` (FR-08): 10 units at 18,500.00 gives 185,000.00.
- `gainOrLoss(value, totalCost)` returns the signed amount `value - totalCost` and the percentage as signed basis points, `round half away from zero(amount * 10000 / totalCost)` (FR-09): 35,000.00 over 150,000.00 gives 2333, shown as 23.33%.
- `isPriceStale(pricedAt, now)` is true when `now - pricedAt` exceeds `STALE_PRICE_AFTER_MS` (FR-11).
- `totalsByCurrency(holdings)` sums the values of holdings that have a value, per valuation currency, leaving out holdings without a price (FR-10, FR-15).
- `parseScaledDecimal(text, scale)` accepts digits with one optional `.` and at most `log10(scale)` decimals and returns a `BigInt`, or `null` for anything else; `formatScaledDecimal(value, scale)` is its inverse; both are pure string and `BigInt` operations.
- Contracts: `createPortfolioRequestSchema` (name), `addHoldingRequestSchema` (ticker, instrumentName, instrumentType, quantity, valuationCurrency, optional totalCost, with a refinement that crypto requires USD, FR-14), `updateHoldingRequestSchema` (optional quantity, totalCost as string or null, valuationCurrency; at least one field; a valuationCurrency without a totalCost key is invalid, FR-17), `setPriceRequestSchema` (unitPrice), `portfolioIdParamsSchema`, `holdingIdParamsSchema`, `holdingResponseSchema`, `portfolioResponseSchema`, `portfolioListResponseSchema`, `addHoldingResponseSchema` (holding plus `merged`). Integers travel as strings matching `^(0|[1-9][0-9]*)$` (signed for gain fields), so JSON never carries a float. Contracts validate integer strings and keep them as strings; request handlers convert to `BigInt` at the boundary and response handlers stringify, so no response contract transforms to `bigint` (`JSON.stringify` cannot serialize one). Values, gains and totals are derived on read as unbounded `BigInt` and are never stored by this ticket; DISC-001-07b must bound or widen them before it stores snapshots.

**Input validation**
- portfolio name: string, trimmed, 1 to 60 characters.
- ticker: string, trimmed, 1 to 20 characters, pattern `^[A-Za-z0-9][A-Za-z0-9._/-]*$`.
- instrument name: string, trimmed, 1 to 100 characters.
- instrument type: one of the seven values; valuation currency: `ARS` or `USD`.
- quantity: integer string from 1 to 10^18 (scaled units); total cost: integer string from 1 to 10^15 or, on update only, null; unit price: integer string from 1 to 10^12.
- ids: UUID strings. Unknown keys are stripped by the shared validation middleware.

**Error handling**
- A request that fails a contract is a validation failure listing the failing field paths, never the values; the shared validation middleware turns it into 400 `VALIDATION_FAILED`.
- Text that is not a valid scaled decimal makes `parseScaledDecimal` return `null`, and the caller shows a field error; it never throws.
- A response that does not match its contract is a 500 `INTERNAL` (fail closed), the existing behavior of `validate`.

**Required tests**
- [ ] `apps/api/test/investments/valuation.test.ts` — 10 units at 18,500.00 values 185,000.00; rounding half up at the minor unit — validates AC-10.
- [ ] `apps/api/test/investments/valuation.test.ts` — gain of 35,000.00 and 2333 basis points for cost 150,000.00 and value 185,000.00; a loss is negative — validates AC-11.
- [ ] `apps/api/test/investments/valuation.test.ts` — `totalsByCurrency` over 185,000.00 ARS, 15,000.00 ARS and 500.00 USD gives 200,000.00 ARS and 500.00 USD; a holding without value is left out — validates AC-13 and AC-20.
- [ ] `apps/api/test/investments/valuation.test.ts` — `isPriceStale` is false at exactly 7 days and true one millisecond later — validates AC-14.
- [ ] `apps/api/test/investments/decimal.test.ts` — `parseScaledDecimal('10.5', 10^8)` and its round trip with `formatScaledDecimal`; invalid text such as `1e3`, `-1`, `1.123456789` and an empty string returns null (invalid input).
- [ ] `apps/api/test/investments/contracts.test.ts` — the seven instrument types and only them are accepted — validates AC-04.
- [ ] `apps/api/test/investments/contracts.test.ts` — quantity `0`, a negative quantity and a non-numeric quantity are rejected — validates AC-03.
- [ ] `apps/api/test/investments/contracts.test.ts` — a unit price of `0` is rejected as invalid — validates AC-08.
- [ ] `apps/api/test/investments/contracts.test.ts` — crypto with ARS is rejected as invalid on the valuationCurrency path — validates AC-18.
- [ ] `apps/api/test/investments/contracts.test.ts` — an update changing the currency without the totalCost key is invalid; an update with no field is invalid; a response with a float amount is rejected.
- [ ] `apps/api/test/investments/no-float-money.test.ts` — the sources under `packages/shared/src/investments` and `apps/api/src/investments` contain no `parseFloat`, `parseInt`, `Number(`, `toFixed`, `Math.round` or `Math.floor` — validates NFR-01 and NFR-02.

**Completion criterion**
`pnpm --filter @argent/api exec vitest run test/investments/valuation.test.ts test/investments/decimal.test.ts test/investments/contracts.test.ts test/investments/no-float-money.test.ts` passes, `pnpm typecheck` passes for `@argent/shared`, and the barrel exports every new contract.

## Block 2 — Investments domain rules and ports

**Files**
- `apps/api/src/investments/domain/holding.ts` (new) — pure rules: `mergeHoldings`, `applyHoldingEdit`, `assertCryptoInUsd`.
- `apps/api/src/investments/domain/errors.ts` (new) — `InvestmentRuleViolation`, a typed error that extends `AppError('VALIDATION_FAILED')` and carries `fields` (its message is only the field names, never a stored value, because the error middleware logs the error), the failing paths in the same `body.<field>` form the validation middleware emits (for example `body.valuationCurrency`).
- `apps/api/src/investments/application/ports.ts` (new) — `PortfolioRepository`, `HoldingRepository`, `InvestmentsUnitOfWork` and `Clock` ports.

**Logic**
- `Holding` is a plain record: id, portfolioId, ticker, instrumentName, instrumentType, quantity (`bigint`), valuationCurrency, totalCost (`bigint` or null), price (unit price, source, pricedAt, or null).
- `mergeHoldings(existing, incoming)` (FR-18, FR-19, FR-20): if the valuation currencies differ it throws `InvestmentRuleViolation('valuationCurrency')` and nothing is merged; otherwise quantity is the sum, total cost is the sum when both are present and null when either is null, and ticker, name, type and price stay those of the existing holding. A sum above the Block 1 limits throws `InvestmentRuleViolation('quantity')` or `('totalCost')`.
- `applyHoldingEdit(existing, patch)` (FR-04, FR-14, FR-17): a new quantity or total cost replaces the old one (null clears the cost); a changed valuation currency requires `patch.totalCost` to be present, throws `InvestmentRuleViolation('totalCost')` otherwise, and clears the price; a crypto holding with ARS throws `InvestmentRuleViolation('valuationCurrency')`.
- `assertCryptoInUsd(type, currency)` (FR-14) is the single check used on create and on edit.
- Ports: repositories take an `AccessScope` first (writes take `AccessScope<'write'>`), exactly like `test/fixtures/fixture-resource-repository.ts`; `InvestmentsUnitOfWork.run(work)` hands transaction-bound repositories to `work`, mirroring `identity/application/ports/unit-of-work.ts`; `Clock` is declared here so the module does not import from `identity`.
- The domain imports nothing from `infrastructure` and nothing from Express, Drizzle or `node:*` (ids are generated by the database default, never in the domain); the application layer imports nothing from `infrastructure`. The existing ESLint globs `apps/api/src/*/domain/**` and `*/application/**` already cover the new module.

**Input validation**
- The domain receives values already parsed by the Block 1 contracts; it re-checks only the rules that depend on stored state (currency and type, merge bounds), never formats.

**Error handling**
- Currency mismatch on merge: `InvestmentRuleViolation('valuationCurrency')`, nothing merged.
- Merged quantity or total cost above the limits: `InvestmentRuleViolation('quantity')` or `('totalCost')`.
- Currency change without a stated total cost: `InvestmentRuleViolation('totalCost')`.
- Crypto holding with ARS: `InvestmentRuleViolation('valuationCurrency')`.

**Required tests**
- [ ] `apps/api/test/investments/holding-rules.test.ts` — merging 5 units at cost 50,000.00 into 10 units at cost 150,000.00 with price 18,500.00 gives 15 units, cost 200,000.00 and the same price — validates AC-23.
- [ ] `apps/api/test/investments/holding-rules.test.ts` — merging across currencies is an invalid merge: it raises a violation on `valuationCurrency` and returns no merged holding — validates AC-24.
- [ ] `apps/api/test/investments/holding-rules.test.ts` — merging when one holding has no total cost leaves the cost null — validates AC-25.
- [ ] `apps/api/test/investments/holding-rules.test.ts` — a merge whose sum exceeds the quantity limit is rejected as invalid on `quantity`; the same for `totalCost`.
- [ ] `apps/api/test/investments/holding-rules.test.ts` — editing the quantity from 10 to 15 keeps price and cost — validates AC-05.
- [ ] `apps/api/test/investments/holding-rules.test.ts` — changing the currency of a priced holding with a stated cost clears the price — validates AC-22.
- [ ] `apps/api/test/investments/holding-rules.test.ts` — changing the currency without a stated total cost is rejected as invalid on `totalCost`.
- [ ] `apps/api/test/investments/holding-rules.test.ts` — editing a crypto holding to ARS is invalid and raises a violation on `valuationCurrency` — validates AC-18.
- [ ] `apps/api/test/foundation/architecture-boundaries.test.ts` — new probe constants for `apps/api/src/investments/domain/probe.ts` and `apps/api/src/investments/application/probe.ts` prove the lint rules reject an import of `infrastructure`, Express, Drizzle or `node:*` from the domain probe and an import of `infrastructure` from the application probe (invalid imports), as they already do for `identity`.

**Completion criterion**
`pnpm --filter @argent/api exec vitest run test/investments/holding-rules.test.ts test/foundation/architecture-boundaries.test.ts` passes and `pnpm typecheck` passes.

## Block 3 — Application use cases and portfolio view

**Files**
- `apps/api/src/investments/application/portfolio-view.ts` (new) — builds holding and portfolio views from stored records.
- `apps/api/src/investments/application/portfolio-use-cases.ts` (new) — `CreatePortfolio`, `ListPortfolios`, `GetPortfolio`, `DeletePortfolio`.
- `apps/api/src/investments/application/holding-use-cases.ts` (new) — `AddHolding`, `GetHolding`, `UpdateHolding`, `SetManualPrice`, `DeleteHolding`.

**Logic**
- `portfolio-view.ts`: for each holding computes `value` (null without a price, FR-15), `gain` (null without a value or without a total cost, FR-09, AC-12), `priceStale` (FR-11) with the injected `Clock`; for each portfolio, `totals` per currency from priced holdings only (FR-10, FR-15) and `holdingsWithoutPrice`, the count of holdings with no price (FR-16). Holdings are ordered by ticker ignoring case, portfolios by creation time.
- `CreatePortfolio` stores a portfolio for the caller (FR-01). `ListPortfolios` and `GetPortfolio` read through a read scope; a missing or foreign portfolio becomes `ResourceNotFound` through `notFoundUnlessAllowed` (FR-12).
- `DeletePortfolio` deletes through a write scope and removes its holdings by cascade; no account balance is touched because the module has no link to accounts (FR-13).
- `AddHolding` runs in the unit of work: it locks the portfolio row, looks up an existing holding with the same ticker ignoring case, and either inserts a new holding without a price (FR-02) or merges (FR-18, FR-19, FR-20), returning the holding and `merged`.
- `UpdateHolding` locks the holding row, applies `applyHoldingEdit` and stores the result (FR-04, FR-17). `SetManualPrice` stores unit price, source `manual` and the clock time (FR-06, FR-07). `DeleteHolding` deletes through a write scope (FR-05). `GetHolding` reads one holding through a read scope.

**Error handling**
- Portfolio or holding missing or outside the caller's scope: `ResourceNotFound` (404), identical for both cases.
- `InvestmentRuleViolation` from the domain is not caught here: it propagates to the single Express error middleware, which maps it to a 400 with its `fields`.
- Repository failures propagate unchanged and become 500 `INTERNAL`; there is no silent catch.

**Required tests**
- [ ] `apps/api/test/investments/portfolio-view.test.ts` — a holding with no price has null value and null gain, and "price needed" is derived from the null value — validates AC-19.
- [ ] `apps/api/test/investments/portfolio-view.test.ts` — one priced holding of 185,000.00 ARS and one without price give a total of 185,000.00 ARS — validates AC-20.
- [ ] `apps/api/test/investments/portfolio-view.test.ts` — a portfolio with 2 unpriced holdings reports `holdingsWithoutPrice` of 2 — validates AC-21.
- [ ] `apps/api/test/investments/portfolio-view.test.ts` — a holding without total cost has no gain — validates AC-12.
- [ ] `apps/api/test/investments/portfolio-view.test.ts` — a price older than 7 days is flagged stale and keeps its date — validates AC-14.
- [ ] `apps/api/test/investments/portfolio-use-cases.test.ts` — creating a portfolio named "Balanz" returns it in the list — validates AC-01.
- [ ] `apps/api/test/investments/portfolio-use-cases.test.ts` — reading or deleting a portfolio outside the scope raises not found (404) and changes nothing — validates AC-15.
- [ ] `apps/api/test/investments/portfolio-use-cases.test.ts` — deleting a portfolio removes its holdings — validates AC-17.
- [ ] `apps/api/test/investments/holding-use-cases.test.ts` — adding "AAPL", CEDEAR, 10 units, ARS, cost 150,000.00 stores it without a price — validates AC-02.
- [ ] `apps/api/test/investments/holding-use-cases.test.ts` — adding "aapl" to a portfolio holding "AAPL" merges and reports `merged` true — validates AC-23.
- [ ] `apps/api/test/investments/holding-use-cases.test.ts` — adding the same ticker with another currency raises the domain violation (400 path) and leaves the holding unchanged — validates AC-24.
- [ ] `apps/api/test/investments/holding-use-cases.test.ts` — deleting a holding removes it and the portfolio total is recomputed — validates AC-06.
- [ ] `apps/api/test/investments/holding-use-cases.test.ts` — a manual price of 18,500.00 ARS is stored with source `manual` and the clock time — validates AC-07 and AC-09.
- [ ] `apps/api/test/investments/holding-use-cases.test.ts` — a currency change clears the stored price and the holding reads "price needed" — validates AC-22.
- [ ] `apps/api/test/investments/holding-use-cases.test.ts` — updating a holding of another user raises not found (404) — validates AC-15.

**Completion criterion**
`pnpm --filter @argent/api exec vitest run test/investments/portfolio-view.test.ts test/investments/portfolio-use-cases.test.ts test/investments/holding-use-cases.test.ts` passes using in-memory fake repositories, and `pnpm typecheck` passes.

## Block 4 — Persistence: migration 0008 and Drizzle repositories

**Files**
- `apps/api/src/investments/infrastructure/db/schema.ts` (new) — the `portfolios` and `holdings` tables, picked up by `drizzle.config.ts` through its `./src/*/infrastructure/db/schema.ts` glob.
- `apps/api/src/investments/infrastructure/db/drizzle-portfolio-repository.ts` (new) — scoped portfolio queries.
- `apps/api/src/investments/infrastructure/db/drizzle-holding-repository.ts` (new) — scoped holding queries, including the ticker lookup ignoring case and the row locks.
- `apps/api/src/investments/infrastructure/db/drizzle-unit-of-work.ts` (new) — one transaction per `run`.
- `apps/api/drizzle/0008_investments.sql` (new, generated by `pnpm db:generate --name investments` and renamed to the reserved number, see the note below) with its snapshot in `apps/api/drizzle/meta/`, an entry tagged `0008_investments` in `apps/api/drizzle/meta/_journal.json` (modified), and `apps/api/drizzle/rollback/0008_investments.down.sql` (new).
- `apps/api/test/identity/migration.test.ts` (modified) — it currently chains `0000` to `0005_two_factor` (`ALL_MIGRATIONS` is 6 on main); it gains one migration, the table lists include `portfolios` and `holdings`, and every rollback sequence undoes `0008_investments` first, then `0005_two_factor` and the older ones.
- `apps/api/test/deploy/build-output.test.ts` (modified) — its expected table list includes the two new tables.

**Logic**
- Migration number note: main already holds `0005_two_factor` (DISC-001-01c). The coordinator reserved `0006` for DISC-001-02a and `0007` for DISC-001-01d, so this migration is `0008_investments`; whichever ticket merges out of order renumbers its migration, snapshot, journal tag and rollback file at merge time, and the chain count in `migration.test.ts` follows what is actually merged. drizzle-kit numbers from the journal, so the implementer generates, renames to `0008_investments`, and verifies that migrating a fresh database works and `pnpm db:generate` shows no diff; a conflict between the reserved gap and drizzle-kit's naming is reported in CODE, not worked around silently. Table names do not collide with any other planned ticket.
- Repositories take the `AccessScope` first and put `scopedTo(scope, { owner: ... })` in the WHERE clause of the same statement, as in the fixture repository; a row outside the scope returns null or false, so the caller cannot tell "missing" from "not allowed" (FR-12).
- The ticker lookup uses `lower(ticker) = lower($1)` in SQL, never JavaScript lowercasing, so it matches the unique index exactly.
- `lockById` and `findForUpdate` use `SELECT ... FOR UPDATE` inside the unit of work; the portfolio lock serializes concurrent adds to one portfolio, so two simultaneous adds of the same ticker cannot both insert.
- Deleting a portfolio deletes its holdings through the foreign key cascade (FR-13); deleting a user cascades through the portfolios (account deletion in DISC-001-01d needs no extra code).
- The list read is two statements: portfolios by owner, holdings by owner (NFR-03).

**Data model**
- Entity `portfolios`: `id` uuid primary key default `gen_random_uuid()`; `owner_id` uuid not null, foreign key to `users(id)` on delete cascade; `name` text not null with check `char_length(name) between 1 and 60`; `created_at` timestamptz not null default `now()`; unique `(id, owner_id)` (target of the composite foreign key below); index `portfolios_owner_id_idx` on `owner_id`.
- Entity `holdings`: `id` uuid primary key default `gen_random_uuid()`; `portfolio_id` uuid not null; `owner_id` uuid not null; composite foreign key `(portfolio_id, owner_id)` to `portfolios(id, owner_id)` on delete cascade, so a holding can never carry a different owner than its portfolio; `ticker` text not null, check length 1 to 20; `instrument_name` text not null, check length 1 to 100; `instrument_type` text not null, check in the seven types; `quantity` bigint (Drizzle `bigint('quantity', { mode: 'bigint' })`, never the default `number` mode, which would lose precision above 2^53) not null, check `quantity > 0 and quantity <= 10^18`; `valuation_currency` text not null, check in `('ARS', 'USD')`; `total_cost` bigint (`mode: 'bigint'`) nullable, check `total_cost > 0 and total_cost <= 10^15`; `unit_price` bigint (`mode: 'bigint'`) nullable, check `unit_price > 0 and unit_price <= 10^12`; `price_source` text nullable, check in the three sources; `priced_at` timestamptz nullable; check that `unit_price`, `price_source` and `priced_at` are all null or all not null; check `instrument_type <> 'crypto' or valuation_currency = 'USD'` (FR-14); `created_at` timestamptz not null default `now()`; unique index `holdings_portfolio_ticker_key` on `(portfolio_id, lower(ticker))` (FR-18); index `holdings_owner_id_idx` on `owner_id`.
- No float column exists in either entity (NFR-01, NFR-02).

**Input validation**
- Repositories receive validated values and rely on the check constraints as the last line of defense; every value reaches SQL as a bound parameter, never concatenated.

**Error handling**
- A unique violation on `holdings_portfolio_ticker_key` after the lock (it cannot happen while the lock is held) is surfaced as an error and becomes 500; it is never swallowed.
- A foreign key or check violation is a programming error and propagates as 500 `INTERNAL`.
- A deadlock or serialization failure aborts the transaction and propagates as 500; the client may retry.

**Required tests**
- [ ] `apps/api/test/identity/migration.test.ts` and `apps/api/test/deploy/build-output.test.ts` — still pass with the new migration and table lists (regression of the existing migration tests).
- [ ] `apps/api/test/investments/investments-migration.test.ts` — the migration applies on a database holding earlier migrations, the tables, constraints and indexes exist, and the rollback script restores the previous state — validates the rollback path of the migration.
- [ ] `apps/api/test/investments/drizzle-repositories.test.ts` — a holding is stored and read back with bigint quantity and cost unchanged — validates AC-02.
- [ ] `apps/api/test/investments/drizzle-repositories.test.ts` — reading, updating and deleting another user's portfolio or holding returns null or false (404 path) and changes no row — validates AC-15.
- [ ] `apps/api/test/investments/drizzle-repositories.test.ts` — listing returns only the caller's portfolios — validates AC-16.
- [ ] `apps/api/test/investments/drizzle-repositories.test.ts` — deleting a portfolio removes its holdings and leaves other users' rows — validates AC-17.
- [ ] `apps/api/test/investments/drizzle-repositories.test.ts` — inserting "AAPL" and "aapl" in one portfolio is rejected by the unique index (duplicate), while the same ticker in two portfolios is allowed — validates AC-23.
- [ ] `apps/api/test/investments/drizzle-repositories.test.ts` — the check constraints reject crypto with ARS, quantity 0 and a half-filled price (invalid rows) — validates AC-18.
- [ ] `apps/api/test/investments/add-holding-concurrency.test.ts` — two concurrent adds of the same ticker end in one holding with the summed quantity and no error — validates AC-23.
- [ ] `apps/api/test/investments/drizzle-repositories.test.ts` — a portfolio named `'; drop table holdings; --` is stored and read back as plain data (injection-shaped input).
- [ ] `apps/api/test/investments/drizzle-repositories.test.ts` — a composite foreign key rejects a holding whose owner differs from its portfolio's owner (invalid owner).

**Completion criterion**
`pnpm --filter @argent/api exec vitest run test/investments/investments-migration.test.ts test/investments/drizzle-repositories.test.ts test/investments/add-holding-concurrency.test.ts test/identity/migration.test.ts test/deploy/build-output.test.ts` passes against PostgreSQL, `pnpm db:generate` produces no further diff, and `pnpm typecheck` passes.

## Block 5 — Portfolio routes and module wiring

**Files**
- `apps/api/src/investments/infrastructure/http/portfolio-routes.ts` (new) — the portfolio routes.
- `apps/api/src/shared/http/error-handler.ts` (modified) — the `AppError` branch of `mapError` adds `fields` to the body when the error carries an array of strings (a structural guard shared with the existing `HttpError` branch, whose status override stays untouched); no per-module catch exists, so there is still one mapping point.
- `apps/api/src/investments/infrastructure/system-clock.ts` (new) — the module's own `Clock` adapter (`new Date()`), so `investments` does not import from `identity`.
- `apps/api/src/investments/index.ts` (new) — `createInvestmentsRoutes({ db, clock, logger })` returns a `RouterFactory` and builds the repositories, use cases and `OwnerOrGroupMemberAccessPolicy` with `DenyAllGroupMembershipReader` from `shared/access/infrastructure` (no group sharing until PRD 05); `clock` defaults to the module's own system clock.
- `apps/api/src/server.ts` (modified) — passes `routerFactories: [createInvestmentsRoutes({ db, logger })]` to `createApp`.

**Logic**
- The router mounts `requireSession` then `requireVerifiedEmail` on `/investments`, builds a scope with `policy.scopeFor(auth, 'read' | 'write')` per request, and calls the use cases; the user id always comes from `auth`, never from the body, params or query (FR-12).
- Every route uses the shared `validate` middleware with Zod contracts from Block 1 for params, query, body and response.
- Reads use a read scope; creation and deletion use a write scope.
- After each successful create or delete the route logs one `investments.mutation` line with request id, user id, action and portfolio id through the module's `Logger`; names, amounts and quantities are never logged (threat R-15).

**API contract**
- `GET /investments/portfolios` — Request: no params. Response 200: `{ portfolios: Portfolio[] }` where each portfolio is `{ id, name, createdAt, totals: [{ currency, value }], holdingsWithoutPrice, holdings: Holding[] }`; amounts and quantities are decimal strings. Error codes: 401 `UNAUTHENTICATED`, 403 `EMAIL_NOT_VERIFIED`. Auth: session cookie, verified email, read scope.
- `GET /investments/portfolios/:portfolioId` — Request: params `{ portfolioId: uuid }`. Response 200: one `Portfolio`. Error codes: 400 `VALIDATION_FAILED`, 401, 403, 404 `NOT_FOUND` for a missing or foreign portfolio. Auth: session cookie, verified email, read scope.
- `POST /investments/portfolios` — Request body: `{ name: string (1 to 60 characters) }`. Response 201: `Portfolio` with empty holdings. Error codes: 400 `VALIDATION_FAILED`, 401, 403. Auth: session cookie, verified email, write scope, origin guard header.
- `DELETE /investments/portfolios/:portfolioId` — Request: params `{ portfolioId: uuid }`. Response 204, no body. Error codes: 400 `VALIDATION_FAILED`, 401, 403, 404. Auth: session cookie, verified email, write scope, origin guard header.

**Input validation**
- Body, params and query go through the Block 1 contracts; the name is trimmed and 1 to 60 characters; ids are UUIDs; unknown keys are stripped.

**Error handling**
- Validation failure: 400 `VALIDATION_FAILED` with the failing paths.
- Missing session: 401 `UNAUTHENTICATED`; unverified email: 403 `EMAIL_NOT_VERIFIED`.
- Missing or foreign portfolio: 404 `NOT_FOUND` with the same body in both cases.
- Unexpected failure: 500 `INTERNAL` with no detail.

**Required tests**
- [ ] `apps/api/test/investments/portfolio-routes.test.ts` — creating a portfolio named "Balanz" returns 201 and the list contains it — validates AC-01.
- [ ] `apps/api/test/investments/portfolio-routes.test.ts` — user B reading or deleting user A's portfolio gets 404 and A's portfolio is unchanged — validates AC-15.
- [ ] `apps/api/test/investments/portfolio-routes.test.ts` — the list shows only the caller's portfolios — validates AC-16.
- [ ] `apps/api/test/investments/portfolio-routes.test.ts` — deleting a portfolio returns 204, removes its holdings and leaves account balances untouched — validates AC-17.
- [ ] `apps/api/test/investments/portfolio-routes.test.ts` — an empty name, a 61-character name and a non-UUID id return 400 invalid.
- [ ] `apps/api/test/investments/portfolio-routes.test.ts` — without a session the routes return 401, and with an unverified email 403.
- [ ] `apps/api/test/foundation/error-handler.test.ts` — an `AppError` that carries `fields` answers 400 with `{ code, fields }`, and one without `fields` still answers `{ code }` only (extends the existing test).
- [ ] `apps/api/test/investments/portfolio-routes.test.ts` — a successful create and a delete each write one `investments.mutation` log line with user id, action and portfolio id and no portfolio name (audit trail).
- [ ] `apps/api/test/investments/portfolio-routes.test.ts` — an unexpected repository error returns 500 `INTERNAL` with no stack or driver text.
- [ ] `apps/api/test/investments/investments-wiring.test.ts` — `createApp` with the module mounts `/investments` behind the real `requireSession`; route tests build the module with their own `MutableClock` (`test/fakes/mutable-clock.ts`) and pass the factory through the harness `routerFactories` option.

**Completion criterion**
`pnpm --filter @argent/api exec vitest run test/investments/portfolio-routes.test.ts test/investments/investments-wiring.test.ts test/foundation/error-handler.test.ts` passes, the four routes answer with the documented bodies and status codes, and `pnpm typecheck` passes.

## Block 6 — Holding routes

**Files**
- `apps/api/src/investments/infrastructure/http/holding-routes.ts` (new) — the holding routes.
- `apps/api/src/investments/index.ts` (modified) — mounts the holding router with the portfolio router.

**Logic**
- Same stack as Block 5: `requireSession`, `requireVerifiedEmail`, scope from the policy, shared `validate`, user id from `auth`.
- Adding answers 201 when a new holding was created and 200 when the ticker already existed and the holding was merged; both carry `merged`.
- `InvestmentRuleViolation` is an `AppError`, so the existing error middleware answers 400 `VALIDATION_FAILED` with its `fields` (for example `body.valuationCurrency`) and nothing else; the web client tells a currency mismatch (FR-19) from a missing total cost (FR-17) by that field. Handlers contain no try/catch.
- Setting a manual price stores the clock time as the price date (FR-06, FR-07).
- After each successful add, merge, edit, price change or delete the route logs one `investments.mutation` line with request id, user id, action and holding id; quantities, costs and prices are never logged (threat R-15).

**API contract**
- `POST /investments/portfolios/:portfolioId/holdings` — Request: params `{ portfolioId: uuid }`, body `{ ticker, instrumentName, instrumentType, quantity, valuationCurrency, totalCost? }` (quantity and totalCost are decimal integer strings: scaled units and minor units). Response 201 or 200: `{ holding: Holding, merged: boolean }`. Error codes: 400 `VALIDATION_FAILED` (including `valuationCurrency` on a merge across currencies and on crypto with ARS), 401, 403, 404 `NOT_FOUND`. Auth: session cookie, verified email, write scope, origin guard header.
- `GET /investments/holdings/:holdingId` — Request: params `{ holdingId: uuid }`. Response 200: `Holding` with `unitPrice`, `priceSource`, `pricedAt`, `priceStale`, `value`, `gain`. Error codes: 400, 401, 403, 404. Auth: session cookie, verified email, read scope.
- `PATCH /investments/holdings/:holdingId` — Request: params `{ holdingId: uuid }`, body with at least one of `quantity`, `totalCost` (string or null), `valuationCurrency`; a `valuationCurrency` requires the `totalCost` key. Response 200: `Holding`. Error codes: 400 `VALIDATION_FAILED` (`totalCost` when a currency change states no cost, `valuationCurrency` for crypto with ARS), 401, 403, 404. Auth: session cookie, verified email, write scope, origin guard header.
- `PUT /investments/holdings/:holdingId/price` — Request: params `{ holdingId: uuid }`, body `{ unitPrice: integer string in minor units }`. Response 200: `Holding` with source `manual`. Error codes: 400, 401, 403, 404. Auth: session cookie, verified email, write scope, origin guard header.
- `DELETE /investments/holdings/:holdingId` — Request: params `{ holdingId: uuid }`. Response 204, no body. Error codes: 400, 401, 403, 404. Auth: session cookie, verified email, write scope, origin guard header.

**Input validation**
- Every body goes through the Block 1 contracts: ticker pattern and length, instrument name length, instrument type and currency enumerations, quantity from 1 to 10^18, total cost from 1 to 10^15 or null on update, unit price from 1 to 10^12, ids as UUIDs.
- A request carrying `ownerId` or any unknown key has it stripped; ownership is never read from input.

**Error handling**
- Validation failure: 400 `VALIDATION_FAILED` with failing paths.
- Domain rule violation (currency mismatch, crypto in ARS, missing cost on currency change, merge above limits): 400 `VALIDATION_FAILED` with the `body.<field>` path, the same form the validation middleware uses for the contract refinement of the same rule.
- Missing or foreign holding or portfolio: 404 `NOT_FOUND`, same body in both cases.
- Missing session 401, unverified email 403, unexpected failure 500 `INTERNAL`.

**Required tests**
- [ ] `apps/api/test/investments/holding-routes.test.ts` — adding "AAPL", CEDEAR, 10 units, ARS, cost 150,000.00 returns 201 with no price — validates AC-02.
- [ ] `apps/api/test/investments/holding-routes.test.ts` — quantity `0` and a negative quantity return 400 invalid — validates AC-03.
- [ ] `apps/api/test/investments/holding-routes.test.ts` — editing the quantity from 10 to 15 returns the recomputed value — validates AC-05.
- [ ] `apps/api/test/investments/holding-routes.test.ts` — deleting a holding returns 204 and the portfolio total is recomputed — validates AC-06.
- [ ] `apps/api/test/investments/holding-routes.test.ts` — a manual price of 18,500.00 ARS returns source `manual` and value 185,000.00 for 10 units — validates AC-07, AC-10 and AC-09.
- [ ] `apps/api/test/investments/holding-routes.test.ts` — a manual price of `0` returns 400 invalid — validates AC-08.
- [ ] `apps/api/test/investments/holding-routes.test.ts` — a holding with cost 150,000.00 and value 185,000.00 returns gain 35,000.00 and 2333 basis points; without a cost the gain is null — validates AC-11 and AC-12.
- [ ] `apps/api/test/investments/holding-routes.test.ts` — a holding without a price returns null value and null gain, and the portfolio excludes it from totals and counts it — validates AC-19, AC-20 and AC-21.
- [ ] `apps/api/test/investments/holding-routes.test.ts` — a price set 8 days ago (clock moved) returns `priceStale` true with its date — validates AC-14.
- [ ] `apps/api/test/investments/holding-routes.test.ts` — user B reading, editing, pricing or deleting user A's holding gets 404 and nothing changes; adding to A's portfolio gets 404 — validates AC-15.
- [ ] `apps/api/test/investments/holding-routes.test.ts` — adding a crypto holding with ARS returns 400 invalid on `valuationCurrency`; editing a crypto holding to ARS returns 400 — validates AC-18.
- [ ] `apps/api/test/investments/holding-routes.test.ts` — changing the currency with a stated cost clears the price; without the cost key returns 400 invalid on `totalCost` — validates AC-22.
- [ ] `apps/api/test/investments/holding-routes.test.ts` — adding "aapl" to a portfolio holding "AAPL" returns 200 `merged` true with 15 units, cost 200,000.00 and the old price — validates AC-23.
- [ ] `apps/api/test/investments/holding-routes.test.ts` — adding the same ticker with another currency returns 400 invalid on `valuationCurrency` and the holding is unchanged — validates AC-24.
- [ ] `apps/api/test/investments/holding-routes.test.ts` — merging with one missing cost returns a null cost — validates AC-25.
- [ ] `apps/api/test/investments/holding-routes.test.ts` — each successful mutation writes one `investments.mutation` log line with user id, action and holding id and no quantity, cost or price (audit trail).
- [ ] `apps/api/test/investments/holding-routes.test.ts` — an unexpected repository error returns 500 `INTERNAL`; no session returns 401.

**Completion criterion**
`pnpm --filter @argent/api exec vitest run test/investments/holding-routes.test.ts` passes against PostgreSQL, the five routes answer with the documented bodies and status codes, and `pnpm typecheck` passes.

## Block 7 — Web API client and formatting helpers

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — adds PUT, PATCH and DELETE methods, a `fields` list on `ApiFailure`, and the investments calls.
- `apps/web/src/lib/format-amount.ts` (new) — locale formatters for amounts, quantities, percentages and dates.
- `apps/web/src/features/investments/decimal-input.ts` (new) — turns what the user typed into the integer strings the API expects.

**Logic**
- The client gains `listPortfolios`, `createPortfolio`, `deletePortfolio`, `addHolding`, `updateHolding`, `setHoldingPrice` and `deleteHolding`, each parsing its response with the Block 1 contracts and sending `X-Requested-With`, credentials and the refresh-on-401 behavior already in `request`.
- `ApiFailure` gains an optional `fields: string[]` taken from the parsed error body (the shared `errorResponseSchema` already carries it, so no change to `packages/shared/src/errors.ts`); the key is omitted, not set to `undefined`, when the body has none, so existing assertions on failures keep passing. `RequestOptions.method` widens to `'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'`; no new error code is added, so `MESSAGE_KEY_BY_CODE` and `ApiErrorKey` do not change.
- `format-amount.ts` converts minor units and scaled quantities with the shared `formatScaledDecimal` and passes the decimal string to `Intl.NumberFormat.format` (exact for decimal strings in Node 24 and current browsers, the supported targets), so no floating point is involved; the date formatter uses the user's time zone from the session.
- `decimal-input.ts` normalizes a typed comma or dot, calls `parseScaledDecimal` with scale 100 for amounts and 10^8 for quantities, and returns the integer string or an error key (empty, not a number, too many decimals, not above zero).

**Input validation**
- Typed text accepts digits and one decimal separator only, at most 2 decimals for amounts and 8 for quantities, and must be greater than 0; anything else yields an error key and nothing is sent.

**Error handling**
- A network failure keeps the existing `NETWORK` failure; a body that does not match its contract becomes `INTERNAL`.
- A 400 keeps its `fields`; a 404 keeps `NOT_FOUND`; an unparseable typed number returns an error key instead of throwing.

**Required tests**
- [ ] `apps/web/test/api-client-investments.test.ts` — `listPortfolios` parses a valid list and sends credentials — validates AC-16.
- [ ] `apps/web/test/api-client-investments.test.ts` — `addHolding`, `updateHolding`, `setHoldingPrice`, `deleteHolding` and `deletePortfolio` call the documented methods and paths with the origin guard header — validates AC-02, AC-05, AC-07, AC-06 and AC-17.
- [ ] `apps/web/test/api-client-investments.test.ts` — a 400 response with fields exposes `fields` on the failure; a 404 and a network error map to their failures (error paths) — validates AC-24 and AC-15.
- [ ] `apps/web/test/format-amount.test.ts` — 18500000 minor units formats as 185,000.00 in English and 185.000,00 in Spanish; 2333 basis points formats as 23.33% — validates AC-10 and AC-11.
- [ ] `apps/web/test/no-float-money.test.ts` — `format-amount.ts` and every file under `apps/web/src/features/investments` contain no `parseFloat`, `parseInt`, `Number(`, `toFixed`, `Math.round` or `Math.floor` — validates NFR-01 and NFR-02.
- [ ] `apps/web/test/decimal-input.test.ts` — "10,5" and "10.5" both become 1050000000; "18500.00" becomes 1850000 — validates AC-02.
- [ ] `apps/web/test/decimal-input.test.ts` — "", "abc", "0", "-1" and "1.123456789" return an error key (invalid input) — validates AC-03 and AC-08.

**Completion criterion**
`pnpm --filter @argent/web exec vitest run test/api-client-investments.test.ts test/format-amount.test.ts test/decimal-input.test.ts test/no-float-money.test.ts` passes, the existing `api-client.test.ts` still passes, and `pnpm typecheck` passes.

## Block 8 — Web display components and catalogs

**Files**
- `apps/web/src/components/ui/select.tsx` (new) — a native `select` styled with theme tokens, owned source like the other UI primitives.
- `apps/web/src/features/investments/components/holding-row.tsx` (new) — one holding: value or "price needed", gain or loss, stale date, expandable details.
- `apps/web/src/features/investments/components/portfolio-card.tsx` (new) — one portfolio: name, totals per currency, "N holdings without price", its holdings.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — an `investments` namespace and the new navigation label.

**Logic**
- Both components are presentational: props in, callbacks out, no data fetching (container/presentational split from AGENTS.md).
- `HoldingRow` shows ticker, name, type, quantity, the formatted value or the text "price needed" when there is no value (FR-15), and the gain or loss with its sign and percentage only when present (FR-09); a stale price shows its date next to the holding (FR-11); an expandable detail shows source and date and time of the latest price (FR-07) and the actions edit, set price and delete.
- `PortfolioCard` shows the totals per currency (FR-10) and, when the count is above 0, the indicator "N holdings without price" (FR-16), with plural forms in both languages.
- Colors, spacing and radii come from theme tokens; gains use the foreground token and losses the `destructive` token (no new color is hardcoded), and both are distinguished by sign and text as well as color. Every string comes from the catalogs in Spanish and English.

**Input validation**
- Display components accept no user input; the `select` forwards its native value and `required` and `disabled` attributes.

**Error handling**
- A holding with a null value renders "price needed" instead of a number; a null gain renders nothing.
- An unknown instrument type or source renders the raw key instead of throwing, so a newer API never breaks the screen.

**Required tests**
- [ ] `apps/web/test/holding-row.test.tsx` — value 185,000.00 ARS is shown for a priced holding — validates AC-10.
- [ ] `apps/web/test/holding-row.test.tsx` — gain 35,000.00 ARS and 23.33% are shown; with no total cost nothing is shown — validates AC-11 and AC-12.
- [ ] `apps/web/test/holding-row.test.tsx` — a holding without price shows "price needed", no gain and no value — validates AC-19.
- [ ] `apps/web/test/holding-row.test.tsx` — opening the details shows the price source and its date and time — validates AC-09.
- [ ] `apps/web/test/holding-row.test.tsx` — a stale price shows its date next to the holding and a fresh one does not — validates AC-14.
- [ ] `apps/web/test/portfolio-card.test.tsx` — totals of 200,000.00 ARS and 500.00 USD are shown — validates AC-13 and AC-20.
- [ ] `apps/web/test/portfolio-card.test.tsx` — "2 holdings without price" is shown for 2 unpriced holdings and nothing for 0 — validates AC-21.
- [ ] `apps/web/test/portfolio-card.test.tsx` — an unknown instrument type renders without error (unexpected value).
- [ ] `apps/web/test/i18n-catalogs.test.ts` — the existing key-parity check covers the new `investments` namespace in both catalogs, and a new assertion proves the namespace is present in both.

**Completion criterion**
`pnpm --filter @argent/web exec vitest run test/holding-row.test.tsx test/portfolio-card.test.tsx test/i18n-catalogs.test.ts` passes, and `pnpm typecheck` and `pnpm lint` pass.

## Block 9 — Web forms

**Files**
- `apps/web/src/features/investments/components/create-portfolio-form.tsx` (new) — name field.
- `apps/web/src/features/investments/components/add-holding-form.tsx` (new) — ticker, name, type, quantity, currency, optional total cost.
- `apps/web/src/features/investments/components/edit-holding-form.tsx` (new) — quantity, total cost, currency.
- `apps/web/src/features/investments/components/price-form.tsx` (new) — manual unit price.
- `apps/web/src/features/investments/holding-form-errors.ts` (new) — maps API failures and typed-number errors to keys of the `investments.errors` catalog namespace.

**Logic**
- Error keys are the feature's own (`investments.errors.*`, for example network, retry later, unexpected, currency mismatch, cost required, crypto only in USD, not found), rendered through `useTranslations`; the auth `FormAlert` and its `ErrorMessageKey` type are not reused because they only cover the `errors` namespace of the auth catalogs.
- Following the auth forms, `pending` and the API error keys come in as props from the container, so the forms stay pure; the forms validate typed text, keep submit disabled while `pending`, and hold no data fetching.
- Forms are presentational: they validate typed text with `decimal-input.ts` and the shared Zod contracts, call the `onSubmit` prop with the parsed values and show the error keys they are given.
- The type picker offers exactly the seven types (FR-03); choosing crypto sets the currency to USD and disables the ARS option (FR-14).
- The edit form sends the total cost together with a changed currency, and tells the user that changing the currency clears the price and asks for the cost again (FR-17).
- An add that the API merges is reported to the container, which tells the user the holding was merged (FR-18); a 400 on `valuationCurrency` while adding shows the mismatch message (FR-19), on `totalCost` the required-cost message (FR-17).

**Input validation**
- Name: 1 to 60 characters; ticker: 1 to 20 characters with the shared pattern; instrument name: 1 to 100; quantity and price greater than 0 with at most 8 and 2 decimals; total cost optional but greater than 0 when typed; every error is shown next to its field with `aria-invalid` and focus moves to the first invalid field.

**Error handling**
- Invalid typed text blocks the submit and shows the field message; nothing is sent.
- API failures map to a form-level message: validation fields to their field, network to the retry text, unexpected to the generic text.
- Submitting twice is prevented while a request is pending.

**Required tests**
- [ ] `apps/web/test/create-portfolio-form.test.tsx` — submitting "Balanz" calls `onSubmit` with that name — validates AC-01.
- [ ] `apps/web/test/add-holding-form.test.tsx` — submitting AAPL, CEDEAR, 10, ARS, cost 150,000.00 sends the scaled integers — validates AC-02.
- [ ] `apps/web/test/add-holding-form.test.tsx` — quantity 0 or negative shows a field error and sends nothing (invalid) — validates AC-03.
- [ ] `apps/web/test/add-holding-form.test.tsx` — the type picker offers exactly the seven types — validates AC-04.
- [ ] `apps/web/test/add-holding-form.test.tsx` — choosing crypto forces USD and the ARS option is unavailable — validates AC-18.
- [ ] `apps/web/test/add-holding-form.test.tsx` — a 400 on `valuationCurrency` shows the currency mismatch message (rejected merge) — validates AC-24.
- [ ] `apps/web/test/edit-holding-form.test.tsx` — changing the quantity to 15 sends only the quantity — validates AC-05.
- [ ] `apps/web/test/edit-holding-form.test.tsx` — changing the currency sends the total cost with it and shows the price-cleared notice — validates AC-22.
- [ ] `apps/web/test/price-form.test.tsx` — 18,500.00 sends 1850000 minor units — validates AC-07.
- [ ] `apps/web/test/price-form.test.tsx` — a price of 0 shows a field error and sends nothing (invalid) — validates AC-08.
- [ ] `apps/web/test/holding-form-errors.test.ts` — the field `body.valuationCurrency` maps to the currency mismatch key, `body.totalCost` to the cost-required key (rejected input).
- [ ] `apps/web/test/holding-form-errors.test.ts` — a network failure maps to the retry key and an unexpected 500 to the generic key (error paths).

**Completion criterion**
`pnpm --filter @argent/web exec vitest run test/create-portfolio-form.test.tsx test/add-holding-form.test.tsx test/edit-holding-form.test.tsx test/price-form.test.tsx test/holding-form-errors.test.ts` passes, forms pass the existing accessibility checks style (labels, `aria-invalid`), and `pnpm typecheck` and `pnpm lint` pass.

## Block 10 — Web container, route and navigation

**Files**
- `apps/web/src/features/investments/containers/investments-container.tsx` (new) — loads the portfolios, runs the mutations, reloads after each change.
- `apps/web/src/features/investments/components/investments-screen.tsx` (new) — presentational layout: loading, empty, failed and loaded states.
- `apps/web/src/app/[locale]/(app)/investments/page.tsx` (new) — the route.
- `apps/web/src/features/auth/components/authenticated-shell.tsx` (modified) — a third link, Investments, in the header `nav` that already holds Home and Security; it uses the locale-aware `Link`, the same ghost `buttonVariants`, a Lucide icon, `aria-current` from `currentPath` and a label under `app.nav` in the catalogs.

**Logic**
- The container reads the user's time zone once from `getSession()` (already on the client) and passes it to the date formatter; if that call fails the formatter falls back to the browser's time zone.
- The container calls the API client through `useApiClient`, keeps loading, failed and loaded states, and after every create, merge, edit, price or delete reloads the list so every value shown is the server's.
- A successful delete asks for a second confirmation inside the screen before calling the API (deleting a portfolio removes all its holdings, FR-13), and reports that no account balance changed.
- The screen shows the empty state "create your first portfolio" when there are none, and only the signed-in user's portfolios (FR-12 is enforced by the API; the screen shows what it returns).
- Server Components never touch financial data: the page renders the container, and all data goes through the Express API (AGENTS.md).

**Input validation**
- The container accepts no free text itself; forms validate and the API validates again.

**Error handling**
- A failed load shows the error text with a retry button and keeps the previous list if there was one.
- A failed mutation shows its message above the affected portfolio and leaves the list unchanged.
- A 401 sends the user to sign-in through the existing shell behavior.

**Required tests**
- [ ] `apps/web/test/investments-container.test.tsx` — a created portfolio "Balanz" appears in the list — validates AC-01.
- [ ] `apps/web/test/investments-container.test.tsx` — deleting a holding reloads the list and the total — validates AC-06.
- [ ] `apps/web/test/investments-container.test.tsx` — deleting a portfolio asks for confirmation, then removes it with its holdings — validates AC-17.
- [ ] `apps/web/test/investments-container.test.tsx` — the screen shows only the portfolios the API returned — validates AC-16.
- [ ] `apps/web/test/investments-container.test.tsx` — an add answered as merged shows the merged notice and the summed quantity — validates AC-23.
- [ ] `apps/web/test/investments-container.test.tsx` — a failed load shows the error and a retry that reloads (error path).
- [ ] `apps/web/test/investments-container.test.tsx` — a failed mutation (error 404) shows the generic message above the portfolio and leaves the list unchanged — validates AC-15.
- [ ] `apps/web/test/investments-container.test.tsx` — a 401 error answer sends the user to sign-in through the shell.
- [ ] `apps/web/test/routes.test.tsx` — imports the new `investments/page` and renders it inside the authenticated layout (extends the existing routes test).
- [ ] `apps/web/test/authenticated-shell-container.test.tsx` and `apps/web/test/auth-components.test.tsx` — the header shows the Investments link beside Home and Security, marks it current on `/investments`, and the existing shell behaviors still hold (updated existing tests).

**Completion criterion**
`pnpm --filter @argent/web exec vitest run test/investments-container.test.tsx test/routes.test.tsx test/authenticated-shell-container.test.tsx` passes, `pnpm --filter @argent/web build` succeeds, and `pnpm typecheck` and `pnpm lint` pass.

## Block 11 — Performance benchmark and end-to-end flow

**Files**
- `apps/api/test/perf/portfolio-latency.perf.test.ts` (new) — benchmark of the portfolio list.
- `apps/web/e2e/investments.spec.ts` (new) — Playwright flow.

**Logic**
- The benchmark seeds one user with 10 portfolios and 500 holdings (priced and unpriced), runs `autocannon` against the list route through the real app and the test database, and asserts p95 below 500 ms (NFR-03). It follows `auth-latency.perf.test.ts` and runs with `pnpm test:perf`, outside `pnpm test`.
- The end-to-end flow registers and verifies a user through Mailpit as `auth.spec.ts` does, creates a portfolio, adds a holding, sets a manual price, checks the value and gain, merges a second add of the same ticker, then deletes the portfolio. Strings come from the catalogs support helper, not literals.

**Input validation**
- The benchmark and the flow use only values accepted by the Block 1 contracts; the flow also submits an invalid quantity once to check the visible error.

**Error handling**
- The benchmark fails the run with the measured p95 in the message when the threshold is exceeded.
- The end-to-end flow uses a unique email per run and cleans nothing that other specs read.

**Required tests**
- [ ] `apps/api/test/perf/portfolio-latency.perf.test.ts` — p95 of the list below 500 ms for 10 portfolios and 500 holdings — validates NFR-03.
- [ ] `apps/web/e2e/investments.spec.ts` — create "Balanz", add AAPL CEDEAR 10 ARS cost 150,000.00, set the price 18,500.00 and see 185,000.00 and a gain of 35,000.00 and 23.33% — validates AC-01, AC-02, AC-07, AC-10 and AC-11.
- [ ] `apps/web/e2e/investments.spec.ts` — a holding without price shows "price needed" and the portfolio shows "1 holding without price" — validates AC-19 and AC-21.
- [ ] `apps/web/e2e/investments.spec.ts` — adding "aapl" again merges into one holding of 15 units — validates AC-23.
- [ ] `apps/web/e2e/investments.spec.ts` — a quantity of 0 shows the validation error and creates nothing (invalid input) — validates AC-03.
- [ ] `apps/web/e2e/investments.spec.ts` — a second user does not see the first user's portfolios — validates AC-16.

**Completion criterion**
`pnpm test:perf` passes the new benchmark with p95 under 500 ms and `pnpm e2e` passes `investments.spec.ts` against PostgreSQL and Mailpit.

## Final verification
- Every FR and NFR of the PRD is covered by the table above and every AC is named by at least one test.
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (80% lines, branches and functions over the three trees together), `pnpm test:perf` and `pnpm e2e` pass.
- No money, rate or quantity uses floating point anywhere, including tests (the Block 1 source scan enforces it for the shared helpers).
- Another user's portfolio or holding answers 404 on every route; every repository method requires an `AccessScope`.
- The migration applies and rolls back; its number (`0008`) may be renumbered at merge time if the planned migrations of other tickets merge in a different order.
- No external service is called by this ticket; CoinGecko, import and snapshots belong to DISC-001-07b and DISC-001-07c.
