# Verification DISC-001-07a

| Field | Value |
|---|---|
| Module | `apps/api/src/investments`, `packages/shared/src/investments`, `apps/web/src/features/investments`, migration `0008_investments` |
| Line coverage | 97.09% |
| Branch coverage | 93.17% |
| Function coverage | 94.72% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `npx eslint .` clean, `npx prettier --check --end-of-line auto .` clean, `pnpm typecheck` clean |

## Round 1 (independent `ddw-module-verifier`, sonnet)

Cross-verification of the whole module by an agent that did not write the code, with specific
attention to the round-2 changes of blocks 2, 3, 4, 7, 8, 9 and 10 that had no independent
re-review. It ran the web suite (711 passed) and the API `test/investments` and `test/foundation`
suites (308 passed), eslint, prettier and typecheck; it did not run e2e (shared ports) or the
benchmark; coverage is from the CODE-phase run.

## Acceptance criteria
- ✅ AC-01 — `portfolio-routes.test` "creates a portfolio named Balanz with 201 and lists it (AC-01)" (`portfolio-use-cases.ts:CreatePortfolio`)
- ✅ AC-02 — `holding-routes.test` "adds AAPL as a CEDEAR with 201 and no price (AC-02)" (`holding-use-cases.ts:AddHolding`)
- ✅ AC-03 — `holding-routes.test` "rejects quantity 0 and a negative quantity (AC-03)" (`contracts.ts`)
- ✅ AC-04 — `contracts.test` "accepts exactly the seven instrument types (AC-04)"
- ✅ AC-05 — `holding-routes.test` "edits the quantity from 10 to 15 (AC-05)" (`holding.ts:applyHoldingEdit`)
- ✅ AC-06 — `holding-routes.test` "deletes with 204 and recomputes the portfolio total (AC-06)"
- ✅ AC-07 — `holding-routes.test` "sets a manual price of 18,500.00 (AC-07, AC-09, AC-10)" (`holding-use-cases.ts:SetManualPrice`)
- ✅ AC-08 — `holding-routes.test` "rejects a manual price of 0 with 400 on body.unitPrice (AC-08)"
- ✅ AC-09 — `holding-row.test` "AC-09: opening the details shows unit price, source and date and time"
- ✅ AC-10 — `valuation.test` "10 units at 18,500.00 values 185,000.00" (`valuation.ts:holdingValue`)
- ✅ AC-11 — `valuation.test` gain 2333 basis points (`valuation.ts:gainOrLoss`)
- ✅ AC-12 — `portfolio-view.test` "gives a holding without total cost a value but no gain (AC-12)"
- ✅ AC-13 — `valuation.test` totals 200,000.00 ARS and 500.00 USD (`valuation.ts:totalsByCurrency`)
- ✅ AC-14 — `valuation.test` stale boundary at exactly 7 days (`valuation.ts:isPriceStale`)
- ✅ AC-15 — `holding-routes.test` "answers 404 to user B on every route (AC-15)" (`scopedTo` in every repository)
- ✅ AC-16 — `portfolio-routes.test` "lists only the portfolios of the caller (AC-16)"
- ✅ AC-17 — `portfolio-routes.test` "deletes with 204, removes its holdings (AC-17)" (FK cascade; see warning W1)
- ✅ AC-18 — `holding-routes.test` "rejects crypto in ARS on add and on edit (AC-18)" (`holding.ts:assertCryptoInUsd`)
- ✅ AC-19 — `portfolio-view.test` "AC-19" (`portfolio-view.ts:buildHoldingView`)
- ✅ AC-20 — `portfolio-view.test` "totals only priced holdings (AC-20)"
- ✅ AC-21 — `portfolio-view.test` "counts holdings without a price (AC-21)"
- ✅ AC-22 — `holding-routes.test` "clears the price when the currency changes (AC-22)"
- ✅ AC-23 — `holding-routes.test` "merges aapl into AAPL with 200 (AC-23)" and `add-holding-concurrency.test`
- ✅ AC-24 — `holding-routes.test` "rejects a merge in another currency (AC-24)" (`holding.ts:mergeHoldings`)
- ✅ AC-25 — `holding-routes.test` "merges with one missing cost into a null cost (AC-25)"

## Spec blocks
- ✅ Block 1 — shared contracts, decimal helpers, valuation: every task done, every Required test present and passing
- ✅ Block 2 — domain rules and ports, architecture boundary probes: every task done
- ✅ Block 3 — use cases and portfolio view: every task done
- ✅ Block 4 — migration `0008_investments` (journal idx 8, `when` 1790943101410, greater than 1790895423195), repositories, unit of work, concurrency: every task done
- ✅ Block 5 — portfolio routes, module wiring, error middleware `fields`: every task done
- ✅ Block 6 — holding routes: every task done
- ✅ Block 7 — web API client and formatting helpers: every task done
- ✅ Block 8 — display components and catalogs: every task done
- ✅ Block 9 — forms: every task done (see corrections below)
- ✅ Block 10 — container, route, navigation: every task done (see corrections below)
- ✅ Block 11 — `portfolio-latency.perf.test` (p95 44.27 ms against 500 ms) and `investments.spec.ts` (e2e 60/60 in the CODE run)

## Tests
- ✅ Sad-path tests: every route and input-taking function has one, for example `holding-routes.test` quantity 0, crypto in ARS, currency mismatch, foreign holding 404, 401 and 403 and 500 without leak; `decimal-input.test` rejection tables; `investments-container.test` failed load and failed mutation
- ✅ Suites on this tree: 1884 tests in the full run, 0 failed; web 711 passed, API investments plus foundation 308 passed

## TDD evidence (supplied from the CODE phase implementer reports)

Failing before implementation, per block (assertion or error that broke):
- Block 1: 39/41 failed (`TypeError: totalsByCurrency is not a function`, same for `holdingValue`, `gainOrLoss`, `isPriceStale`); round 2: 12/12 changed tests failed (`holdingIdParams { holdingId } only: expected false to be true`, `expected 1111…100000000n to be null`, `expected function to throw an error` for invalid scales and non-positive cost).
- Block 2: 14/14 failed (`Cannot find module '../../src/investments/domain/errors'`); round 2: `expected [ 'body.totalCost' ] to deeply equal [ 'body.valuationCurrency' ]`, plus TS2345 and TS2578 typecheck errors for the reshaped merge input and the at-least-one-field constructor.
- Block 3: 34/34 failed (`Cannot find module '../../src/investments/application/portfolio-view'`, same for the two use-case modules); round 2: `expected [ 'c-id', 'a-id', 'b-id' ] to deeply equal [ 'a-id', 'b-id', 'c-id' ]`, `expected [] to include 'holdings.listByPortfolio'`.
- Block 4: migration test `ENOENT … 0008_investments.down.sql` and `relation "portfolios" does not exist`; repository and concurrency files failed to load (module not found); round 2 used mutant checks (`.for('update')` removed → `expected true to be false`; constraint name altered → diff).
- Block 5: 13/15 failed (`Cannot find module '../../src/investments'`; `expected { code: 'VALIDATION_FAILED' } to deeply equal { code: 'VALIDATION_FAILED', fields: ['body.currency'] }`).
- Block 6: 21/22 failed (`expected 404 to be 201`, `expected 404 to be 400`: the routes did not exist).
- Block 7: 13 failed plus 2 files not loading (`TypeError: client.listPortfolios is not a function`, `Cannot find module …/decimal-input`, `…/format-amount`); round 2: `parseQuantityInput('1.000','es')` returned `{ ok: true, value: '100000000' }`.
- Block 8: 23/26 failed (imports of `holding-row` and `portfolio-card` unresolved; `expected 'undefined' to be 'object'` for the catalog namespace); round 2: 14 failing (`formatMoney is not a function`, `Unable to find an accessible element with the role "button" and name "Show details for AAPL"`).
- Block 9: all new files failed to load (module not found); round 2: 14 failing (grouped numbers `expected { ok: false, error: 'notANumber' } to deeply equal { ok: true, value: '15000000' }`, `Unable to find role "status"`, `expected vi.fn() not to be called`).
- Block 10: 19/19 failed (`Failed to resolve import …/investments-container`); round 2: 8 new tests failed (`expected <p data-slot="form-message"> to be null`, `Unable to find a label with the text of: Nombre`, `expected true to be false`, `expected <body> to be <button>`).
- Block 11: the tests were written after the features; each assertion was shown able to fail by temporary mutation (perf limit 1 ms → `p95 was 44.2689 ms, limit 1 ms`; e2e price 18600 and expected `+23,34%` → `Expected substring … Received …`).

Tests that passed before implementation and are therefore regression guards, not evidence: the
architecture boundary probes of Block 2, the Block 5 `ownerId` strip test, the locking call-log
tests of Block 3, and part of the Block 7, 8, 9 and 10 round-2 additions; they are listed as such
in the block reports.

## Findings of the independent verifier

1. High, FR-17: the edit form pre-fills the total cost and, on a currency change, re-sends the old-currency cost unchanged; the notice tells the user the cost must be entered again but the form does not ask for it, and the test "sends the unchanged cost along with a changed currency (AC-22)" asserts that behavior. → required correction.
2. Medium, accessibility: after closing or submitting the add-holding form, focus is restored to the first "Add holding" button on the page, which belongs to the first portfolio when there are two or more; every focus test uses one portfolio. → required correction.
3. Low: after deleting a portfolio, focus lands on another portfolio's "Delete portfolio" button; "Add holding" and "Delete portfolio" share one accessible name in every card. → same change as 2.
4. Medium, race (follow-up, ticket later): an add-merge can overwrite a concurrent edit or manual price of the same user because the ticker read is not locked and edit and price do not lock the portfolio. Recorded as L-1 and L-2 of the SAST report; the human decided they go to a later ticket.
5. Low: deleting a holding whose edit or price form is open leaves a stale open form and no focus restore; a superseded reload still lets the "deleted" notice show.
6. Low, dead code: catalog keys `investments.forms.required` and `investments.forms.confirmDelete.holding` unused; `HOLDINGS_PORTFOLIO_TICKER_KEY` exported but only used in `schema.ts`.
7. Info: the spec text still says `@argent/*` and `Intl.NumberFormat` (the implementation reuses the shared `formatMinorUnits`).

## Warnings
- W1 (W-VER-03): the AC-17 "account balances untouched" assertion is proxied by other users' rows; an assertion on the `accounts` table is feasible.
- W2 (W-VER-03): `format-amount.test.ts` hard-codes ICU date strings tied to the CLDR version of Node 24.13; some tests use 150 ms timing sleeps.
- W3: the e2e is one consolidated test with named steps instead of the five titles in the spec.
- W4: the `scope.ts` fail-closed branch and quantity above the maximum in the add form have no direct test.
- W5: no test asserts that the list route issues exactly two statements.
- W6 (W-VER-01): the dead keys and exported constant of finding 6; `portfolio-view.ts` branch coverage 87.5% (W-VER-02).
- W7: the call-log tests of Block 3 prove call order only; locking is proven by the Block 4 database tests.

Result: BLOCKED
