# PRD DISC-001-03a: Exchange Rates, Store and Sync

| Field | Value |
|-------|-------|
| Ticket | DISC-001-03a |
| Tracker | none |
| Date | 2026-10-02 |
| PRD loops | 1 |
| Loops since last human decision | 0 |

## Context and Problem
First sub-ticket of Movements & Exchange Rates (parent index: `prd-DISC-001-03.md`). Users in
Argentina live in two currencies, and the ARS/USD rate moves constantly and has several "official"
values (oficial, blue, MEP...). Every later movement needs a rate to freeze (see
`docs/ddw/discovery/concept-DISC-001.md`), and entry must never depend on an external service being
up. This ticket keeps an up-to-date local copy of the market rates and exposes it; it records no
movement. Split from `prd-DISC-001-03.md` (2026-10-02, user decision). Requirement IDs were
renumbered; the parent index maps every original ID to its new one.

## Goals
- Keep a local copy of the 7 ARS/USD rate types, refreshed automatically.
- Survive a provider outage by serving the last stored rates, and record that it happened.
- Give the entry forms of later tickets one place to read the latest stored rates.

## Functional Requirements
- FR-01: The system must fetch the buy and sell prices of the 7 rate types (oficial, blue,
  bolsa/MEP, contado con liquidación, mayorista, cripto, tarjeta) from the rate provider and store
  them with their update timestamp.
- FR-02: The system must use the last stored rates when the rate provider does not answer, and
  must record each failed refresh.
- FR-03: The system must allow an authenticated user to read the latest stored buy price, sell
  price and update timestamp of each of the 7 rate types.

## Non-Functional Requirements
- NFR-01: Exchange rates must be stored as integers scaled by 10,000 (4 decimal places), with 0
  floating-point columns or fields for rates.
- NFR-02: The system must refresh market rates every 60 minutes.
- NFR-03: The system must not call the rate provider in the request path of any user request: 0
  provider calls while serving a request.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a scheduled rate refresh succeeds, THE system SHALL store the buy price,
  sell price and update timestamp of each of the 7 rate types.
- AC-02 (FR-02): IF the rate provider fails or times out during a refresh, THEN THE system SHALL
  keep the last stored rates and record the failure.
- AC-03 (FR-03): WHEN an authenticated user requests the latest rates, THE system SHALL return the
  buy price, sell price and update timestamp of each of the 7 rate types as last stored.
- AC-04 (FR-03): IF a request for the latest rates carries no valid session, THEN THE system SHALL
  answer 401 Unauthorized and return no rates.
- AC-05 (FR-03): WHILE no refresh has ever succeeded, THE system SHALL answer a request for the
  latest rates with an empty result instead of an error.

## Out of Scope
- Recording movements, prefilling or freezing a rate on a movement (DISC-001-03b).
- Showing the age of a rate on the entry form (DISC-001-03b).
- Per-user and per-group default rate type (PRD 01 and PRD 05).
- Currencies other than ARS and USD.
- Historical rate series and charts.
- Crypto prices of other assets (PRD 07).

## Risks and Mitigations
- **The rate provider (dolarapi.com) disappears or changes its API** → rates are stored locally
  (FR-01, FR-02) and the provider sits behind one adapter, so it can be replaced.
- **Stale rates used without the user noticing** → the update timestamp is stored and returned
  (AC-03) so that forms can show the age.
- **Rounding errors in rates** → integer scaled rates (NFR-01).
- **A provider answer that is malformed** → the refresh counts as failed and the last stored
  rates are kept (AC-02).

## Dependencies
- dolarapi.com (`/v1/dolares`), the external rate provider, behind one adapter with a fake for
  tests — FR-01, FR-02.
- PRD 01 (Identity & Access) — authenticated sessions (FR-03).
- DISC-001-03b (Expense and Income) — first consumer of the stored rates; later PRDs 05, 06, 07
  and 09 read them too.

## Decision Log
- 2026-09-25: FX conversion automatic by default, editable per movement, rate frozen on each
  movement (concept).
- 2026-09-25: User approved: 60-minute refresh, rates with 4 decimals as scaled integers.
- 2026-10-02: Parent PRD split into DISC-001-03a to 03e by user decision.
- 2026-10-02: FR-03 (read endpoint), AC-04 and AC-05 are not in the original text: the original
  FR-07 and FR-11 need the stored rates to be readable, and a ticket that only writes rates cannot
  be shipped or tested on its own. Listed in the parent index as added while splitting.
- 2026-10-02: Human decision (relayed by the orchestrator): FR-03, AC-04 and AC-05 are ACCEPTED as
  part of this ticket.
- 2026-10-02: Human decision (relayed by the orchestrator): no jump guard on refreshed rates; the
  residual risk of a wrong in-range rate from the provider is accepted by the project owner, because
  rates are visible and editable per movement (DISC-001-03b FR-05). Recorded in the threat model as R-02.
- 2026-10-02: Human decision (relayed by the orchestrator): after a failed refresh the next attempt
  is 5 minutes later (a design constant of the spec, not a requirement; NFR-02 keeps the 60-minute
  cadence after a success).
