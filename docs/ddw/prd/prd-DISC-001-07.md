# PRD DISC-001-07: Investments

| Field | Value |
|-------|-------|
| Ticket | DISC-001 |
| Tracker | none |
| Date | 2026-09-25 |
| PRD loops | 3 |
| Loops since last human decision | 0 |

## Context and Problem
Users of the finance PWA (see `docs/ddw/discovery/concept-DISC-001.md`) hold investments —
stocks, CEDEARs, bonds, mutual funds (FCI), fixed-term deposits, crypto — mostly through a broker
such as Balanz. Without them, the app cannot show real net worth. Balanz has no public API for
client holdings (verified 2026-09-25), and storing broker credentials or scraping was rejected
(concept decision: a breach would expose the user's brokerage account). Balanz does let clients
export their holdings as CSV and PDF.

## Goals
- Let users record their investment holdings by hand, grouped in portfolios (one per broker or
  wallet).
- Import holdings from the broker's CSV export, without ever storing broker credentials.
- Keep valuations as current as reliable free sources allow: automatic prices for crypto, last
  imported or manual price for everything else (decision 2026-09-25).
- Show each holding's value and, when the cost is known, its gain or loss.

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
- FR-07: The system must fetch the USD price of every crypto holding from the crypto price
  provider and use it as that holding's unit price.
- FR-08: The system must store with every unit price its source (import, manual or automatic) and
  its date and time.
- FR-09: The system must compute the value of a holding as its quantity multiplied by its latest
  unit price, in its valuation currency.
- FR-10: The system must compute the gain or loss of a holding with a total cost as its value
  minus its total cost, in amount and in percentage.
- FR-11: The system must show the total value of each portfolio per currency.
- FR-12: The system must allow a user to import a Balanz holdings CSV file into one of their
  portfolios.
- FR-13: The system must show a preview of the holdings read from the file before applying the
  import.
- FR-14: The system must replace all holdings of the target portfolio with the holdings of the
  file when the user confirms the import, keeping the total cost of holdings whose ticker is
  still present.
- FR-15: The system must reject the whole import, applying no change, when the file is not a
  valid Balanz holdings CSV.
- FR-16: The system must not keep the uploaded file after the import is applied or cancelled.
- FR-17: The system must store once a day, at the end of the day in the user's time zone (PRD 01,
  FR-24), the total value of each portfolio per currency, for historical charts (PRD 09).
- FR-18: The system must show, for every holding whose latest price is older than 7 days, the
  date of that price.
- FR-19: The system must let a user read, edit and delete only their own portfolios and holdings.
- FR-20: The system must allow a user to delete a portfolio together with all its holdings.
- FR-21: The system must require USD as the valuation currency of every crypto holding.

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units, with 0 floating-point columns
  or fields for money (concept decision).
- NFR-02: Quantities must be stored as integers scaled by 10^8 (8 decimal places, enough for
  crypto), with 0 floating-point columns or fields for quantities.
- NFR-03: Crypto prices must be refreshed every 60 minutes, using at most 1,000 provider calls
  per month (the free CoinGecko Demo plan allows 10,000).
- NFR-04: An import of a CSV file of up to 1 MB and 1,000 rows must produce its preview in < 5 s.
- NFR-05: 0 uploaded files must remain in any storage after an import is applied or cancelled.
- NFR-06: The portfolio screen must answer in < 500 ms at p95 for a user with 10 portfolios and
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
- AC-09 (FR-07): WHEN a scheduled crypto price refresh succeeds, THE system SHALL update the unit
  price of every crypto holding with source "automatic".
- AC-10 (FR-07): IF the crypto price provider fails or has no price for a ticker, THEN THE system
  SHALL keep the previous price of the affected holdings.
- AC-11 (FR-08): WHEN a user opens a holding, THE system SHALL show the source and the date and
  time of its latest price.
- AC-12 (FR-09): WHEN a holding has 10 units and a latest unit price of 18,500.00 ARS, THE system
  SHALL show a value of 185,000.00 ARS.
- AC-13 (FR-10): WHEN a holding with a total cost of 150,000.00 ARS has a value of 185,000.00
  ARS, THE system SHALL show a gain of 35,000.00 ARS and 23.33%.
- AC-14 (FR-10): WHILE a holding has no total cost, THE system SHALL show no gain or loss for it.
- AC-15 (FR-11): WHEN a portfolio has holdings valued at 185,000.00 ARS, 15,000.00 ARS and 500.00
  USD, THE system SHALL show totals of 200,000.00 ARS and 500.00 USD.
- AC-16 (FR-12): WHEN a user uploads a Balanz holdings CSV file for a portfolio, THE system SHALL
  read its holdings.
- AC-17 (FR-13): WHEN the file has been read, THE system SHALL show the holdings it will create,
  update and remove, before any change is applied.
- AC-18 (FR-14): WHEN a user confirms an import, THE system SHALL leave the portfolio with exactly
  the holdings of the file, with unit prices of source "import", and keep the total cost of
  holdings whose ticker was already present.
- AC-19 (FR-14): WHEN a user cancels an import at the preview, THE system SHALL leave the
  portfolio unchanged.
- AC-20 (FR-15): IF the uploaded file is not a valid Balanz holdings CSV, THEN THE system SHALL
  reject it with the reason and leave the portfolio unchanged.
- AC-21 (FR-16): WHEN an import is applied or cancelled, THE system SHALL delete the uploaded
  file.
- AC-22 (FR-17): WHEN a day ends in the user's time zone, THE system SHALL store the total value of each portfolio per
  currency for that day.
- AC-23 (FR-18): WHILE the latest price of a holding is older than 7 days, THE system SHALL show
  the date of that price next to the holding.
- AC-24 (FR-19): IF a user requests to read, edit or delete a portfolio or holding owned by
  another user, THEN THE system SHALL answer 404 Not Found and leave it unchanged.
- AC-25 (FR-19): WHEN a user opens the investments screen, THE system SHALL show only portfolios
  they own.
- AC-26 (FR-20): WHEN a user deletes a portfolio, THE system SHALL remove it and all its holdings
  and SHALL not change any account balance.
- AC-27 (FR-21): IF a user adds or edits a crypto holding with ARS as valuation currency, THEN THE
  system SHALL reject it.

## Out of Scope
- Storing broker credentials, scraping, or any login on behalf of the user (concept decision).
- Importing PDF files (fragile parsing); only CSV.
- Importing from brokers other than Balanz (a future PRD per broker).
- Official broker API integrations (IOL, others) — candidate for a future PRD.
- Automatic prices for stocks, CEDEARs, bonds and mutual funds (no free, reliable, documented
  source verified; IOL's API requires an IOL client account and BYMA's APIs are commercial).
- Recording individual buy/sell operations, dividends, coupons or fees.
- Performance metrics beyond simple gain/loss (TWR, IRR, benchmarks).
- Linking investment purchases to account movements.
- Tax reports.

## Risks and Mitigations
- **The Balanz CSV format is unknown and may change** → an anonymized sample file is required
  before PLAN; the importer sits behind one adapter; an unknown format is rejected whole, never
  partially applied (FR-15).
- **An import deletes holdings the user added by hand** → the preview lists what will be removed
  before confirming (AC-17); manual holdings belong in a separate portfolio.
- **CoinGecko's free plan changes or disappears** → prices sit behind one adapter; failures keep
  the last price (AC-10); usage stays at 10% of the free quota (NFR-03).
- **Stale valuations presented as current** → price source and date on every holding (FR-08),
  date highlighted after 7 days (FR-18).
- **Uploaded broker files contain sensitive data** → files are deleted after the import (FR-16,
  NFR-05).

## Dependencies
- Balanz holdings CSV export (format to be confirmed with an anonymized sample file) — FR-12,
  FR-15.
- CoinGecko API, Demo plan (free, 100 calls/min, 10,000 calls/month) — FR-07, NFR-03.
- PRD 01 (Identity & Access) — ownership and access control (FR-19), user time zone (FR-17).
- PRD 03 (Movements & Exchange Rates) — rates used when totals are shown converted (PRD 09).
- PRD 09 (Dashboard & Reports) — consumer of daily portfolio values (FR-17).

## Decision Log
- 2026-09-25: No broker credentials or scraping; manual entry + broker report import (concept).
- 2026-09-25: Balanz exports PDF and CSV (user); import CSV only.
- 2026-09-25: Automatic prices where a reliable free source exists (crypto via CoinGecko); last
  import or manual price for the rest.
- 2026-09-25: User approved: portfolios, import replaces the portfolio after preview keeping
  manual costs, positions only (no operations), uploaded file deleted, daily portfolio value
  snapshot, price date shown after 7 days, crypto valued in USD. Pending before PLAN: anonymized
  Balanz CSV sample.
- 2026-09-25: User decision: per-user time zone, mandatory. Dates and scheduled times are
  computed in the user's time zone (PRD 01, FR-24).
