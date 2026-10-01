# PRD DISC-001-07b: Crypto Prices and Daily Portfolio Snapshots

| Field | Value |
|-------|-------|
| Ticket | DISC-001-07b |
| Tracker | none |
| Date | 2026-10-01 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Second sub-ticket of Investments (parent index: `prd-DISC-001-07.md`). Holdings entered in
DISC-001-07a only carry the prices users type in. For crypto a reliable free source exists
(CoinGecko), so those holdings can stay current without user effort. Separately, the dashboard
(PRD 09) needs the history of each portfolio's value, which has to be recorded every day.
Split from `prd-DISC-001-07.md` (2026-10-01, user decision). Requirement IDs were renumbered; the
parent index maps every original ID to its new one.

## Goals
- Keep crypto holdings valued with automatic prices (decision 2026-09-25).
- Record every day the total value of each portfolio, for historical charts (PRD 09).

## Functional Requirements
- FR-01: The system must fetch the USD price of every crypto holding from the crypto price
  provider and use it as that holding's unit price.
- FR-02: The system must store once a day, at the end of the day in the user's time zone (PRD 01,
  FR-24), the total value of each portfolio per currency, for historical charts (PRD 09).

## Non-Functional Requirements
- NFR-01: Crypto prices must be refreshed every 60 minutes, using at most 1,000 provider calls
  per month (the free CoinGecko Demo plan allows 10,000).

## Acceptance Criteria
- AC-01 (FR-01): WHEN a scheduled crypto price refresh succeeds, THE system SHALL update the unit
  price of every crypto holding with source "automatic".
- AC-02 (FR-01): IF the crypto price provider fails or has no price for a ticker, THEN THE system
  SHALL keep the previous price of the affected holdings.
- AC-03 (FR-02): WHEN a day ends in the user's time zone, THE system SHALL store the total value
  of each portfolio per currency for that day.

## Out of Scope
- Automatic prices for stocks, CEDEARs, bonds and mutual funds (no free, reliable, documented
  source verified; IOL's API requires an IOL client account and BYMA's APIs are commercial).
- Charts and converted totals (PRD 09).
- Official broker API integrations (IOL, others) — candidate for a future PRD.

## Risks and Mitigations
- **CoinGecko's free plan changes or disappears** → prices sit behind one adapter; failures keep
  the last price (AC-02); usage stays at 10% of the free quota (NFR-01).

## Dependencies
- DISC-001-07a (Portfolios, Holdings and Manual Valuation) — holdings, prices and portfolio
  totals.
- CoinGecko API, Demo plan (free, 100 calls/min, 10,000 calls/month) — FR-01, NFR-01.
- PRD 01 (Identity & Access) — user time zone (FR-02).
- PRD 09 (Dashboard & Reports) — consumer of daily portfolio values (FR-02).

## Decision Log
- 2026-09-25: Automatic prices where a reliable free source exists (crypto via CoinGecko); last
  import or manual price for the rest.
- 2026-09-25: User approved: daily portfolio value snapshot; crypto valued in USD.
- 2026-09-25: User decision: per-user time zone, mandatory. Dates and scheduled times are
  computed in the user's time zone (PRD 01, FR-24).
- 2026-10-01: Split from DISC-001-07 (user decision).
