# PRD DISC-001-07a: Portfolios, Holdings and Manual Valuation

| Field | Value |
|-------|-------|
| Ticket | DISC-001-07a |
| Tracker | none |
| Date | 2026-10-01 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
First sub-ticket of Investments (parent index: `prd-DISC-001-07.md`). Users of the finance PWA
(see `docs/ddw/discovery/concept-DISC-001.md`) hold investments — stocks, CEDEARs, bonds, mutual
funds (FCI), fixed-term deposits, crypto — mostly through a broker such as Balanz. Without them,
the app cannot show real net worth. Balanz has no public API for client holdings (verified
2026-09-25), and storing broker credentials or scraping was rejected (concept decision: a breach
would expose the user's brokerage account). This sub-ticket delivers manual entry: portfolios,
holdings, manual prices, valuation and gain or loss. Automatic crypto prices and daily snapshots
come in DISC-001-07b; the Balanz CSV import in DISC-001-07c. Split from `prd-DISC-001-07.md`
(2026-10-01, user decision). Requirement IDs were renumbered; the parent index maps every original
ID to its new one.

## Goals
- Let users record their investment holdings by hand, grouped in portfolios (one per broker or
  wallet).
- Show each holding's value and, when the cost is known, its gain or loss.
- Show every price's source and age so a stale valuation is never presented as current.

## Functional Requirements
- FR-01: The system must allow a user to create a portfolio with a name (for example "Balanz" or
  "Binance").
- FR-02: The system must allow a user to add a holding to a portfolio with an instrument ticker,
  an instrument name, an instrument type, a quantity greater than 0, a valuation currency (ARS
  or USD) and an optional total cost.
- FR-03: The system must offer exactly these instrument types: stock, CEDEAR, bond, mutual fund,
  fixed-term deposit, crypto and other.
- FR-04: The system must allow a user to edit the quantity, total cost and valuation currency of
  a holding.
- FR-05: The system must allow a user to delete a holding.
- FR-06: The system must allow a user to set a manual unit price for a holding.
- FR-07: The system must store with every unit price its source (import, manual or automatic) and
  its date and time.
- FR-08: The system must compute the value of a holding as its quantity multiplied by its latest
  unit price, in its valuation currency.
- FR-09: The system must compute the gain or loss of a holding with a total cost as its value
  minus its total cost, in amount and in percentage.
- FR-10: The system must show the total value of each portfolio per currency.
- FR-11: The system must show, for every holding whose latest price is older than 7 days, the
  date of that price.
- FR-12: The system must let a user read, edit and delete only their own portfolios and holdings.
- FR-13: The system must allow a user to delete a portfolio together with all its holdings.
- FR-14: The system must require USD as the valuation currency of every crypto holding.

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units, with 0 floating-point columns
  or fields for money (concept decision).
- NFR-02: Quantities must be stored as integers scaled by 10^8 (8 decimal places, enough for
  crypto), with 0 floating-point columns or fields for quantities.
- NFR-03: The portfolio screen must answer in < 500 ms at p95 for a user with 10 portfolios and
  500 holdings, measured server-side.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user creates a portfolio named "Balanz", THE system SHALL store it and
  show it in the investments screen.
- AC-02 (FR-02): WHEN a user adds a holding "AAPL", CEDEAR, 10 units, ARS, with a total cost of
  150,000.00 ARS, THE system SHALL store it in the portfolio.
- AC-03 (FR-02): IF a user adds a holding with a quantity of 0 or less, THEN THE system SHALL
  reject it.
- AC-04 (FR-03): WHEN a user opens the holding form, THE system SHALL offer exactly the types
  stock, CEDEAR, bond, mutual fund, fixed-term deposit, crypto and other.
- AC-05 (FR-04): WHEN a user changes the quantity of a holding from 10 to 15, THE system SHALL
  persist it and recompute its value.
- AC-06 (FR-05): WHEN a user deletes a holding, THE system SHALL remove it and recompute the
  portfolio total.
- AC-07 (FR-06): WHEN a user sets a manual unit price of 18,500.00 ARS on a holding, THE system
  SHALL use it as the holding's latest price with source "manual".
- AC-08 (FR-06): IF a user sets a manual unit price of 0 or less, THEN THE system SHALL reject it.
- AC-09 (FR-07): WHEN a user opens a holding, THE system SHALL show the source and the date and
  time of its latest price.
- AC-10 (FR-08): WHEN a holding has 10 units and a latest unit price of 18,500.00 ARS, THE system
  SHALL show a value of 185,000.00 ARS.
- AC-11 (FR-09): WHEN a holding with a total cost of 150,000.00 ARS has a value of 185,000.00
  ARS, THE system SHALL show a gain of 35,000.00 ARS and 23.33%.
- AC-12 (FR-09): WHILE a holding has no total cost, THE system SHALL show no gain or loss for it.
- AC-13 (FR-10): WHEN a portfolio has holdings valued at 185,000.00 ARS, 15,000.00 ARS and 500.00
  USD, THE system SHALL show totals of 200,000.00 ARS and 500.00 USD.
- AC-14 (FR-11): WHILE the latest price of a holding is older than 7 days, THE system SHALL show
  the date of that price next to the holding.
- AC-15 (FR-12): IF a user requests to read, edit or delete a portfolio or holding owned by
  another user, THEN THE system SHALL answer 404 Not Found and leave it unchanged.
- AC-16 (FR-12): WHEN a user opens the investments screen, THE system SHALL show only portfolios
  they own.
- AC-17 (FR-13): WHEN a user deletes a portfolio, THE system SHALL remove it and all its holdings
  and SHALL not change any account balance.
- AC-18 (FR-14): IF a user adds or edits a crypto holding with ARS as valuation currency, THEN THE
  system SHALL reject it.

## Out of Scope
- Automatic crypto prices and the daily portfolio value snapshot (DISC-001-07b).
- Importing holdings from a broker file (DISC-001-07c).
- Storing broker credentials, scraping, or any login on behalf of the user (concept decision).
- Automatic prices for stocks, CEDEARs, bonds and mutual funds (no free, reliable, documented
  source verified; IOL's API requires an IOL client account and BYMA's APIs are commercial).
- Recording individual buy/sell operations, dividends, coupons or fees.
- Performance metrics beyond simple gain/loss (TWR, IRR, benchmarks).
- Linking investment purchases to account movements.
- Tax reports.

## Risks and Mitigations
- **Stale valuations presented as current** → price source and date on every holding (FR-07),
  date highlighted after 7 days (FR-11).
- **Rounding errors in value and percentage** → all arithmetic on integers through the shared
  money helpers (NFR-01, NFR-02).

## Dependencies
- DISC-001-01a (Email & Password Authentication) — sessions, ownership and access control
  (FR-12).
- PRD 03 (Movements & Exchange Rates) — rates used when totals are shown converted (PRD 09); not
  needed by this sub-ticket.

## Decision Log
- 2026-09-25: No broker credentials or scraping; manual entry + broker report import (concept).
- 2026-09-25: User approved: portfolios, positions only (no operations), price date shown after 7
  days, crypto valued in USD.
- 2026-10-01: Split from DISC-001-07 (user decision).
