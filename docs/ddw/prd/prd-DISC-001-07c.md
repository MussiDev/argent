# PRD DISC-001-07c: Balanz Holdings CSV Import

| Field | Value |
|-------|-------|
| Ticket | DISC-001-07c |
| Tracker | none |
| Date | 2026-10-01 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Third sub-ticket of Investments (parent index: `prd-DISC-001-07.md`). Typing every holding by hand
is slow for users who hold many instruments at Balanz. Balanz has no public API for client
holdings (verified 2026-09-25), and storing broker credentials or scraping was rejected, but it
lets clients export their holdings as CSV and PDF. **This sub-ticket is blocked until an
anonymized sample of the Balanz CSV exists:** the format is to be confirmed with it, and nothing
about the format is assumed here. Split from `prd-DISC-001-07.md` (2026-10-01, user decision).
Requirement IDs were renumbered; the parent index maps every original ID to its new one.

## Goals
- Import holdings from the broker's CSV export, without ever storing broker credentials.
- Never keep the uploaded file.

## Functional Requirements
- FR-01: The system must allow a user to import a Balanz holdings CSV file into one of their
  portfolios.
- FR-02: The system must show a preview of the holdings read from the file before applying the
  import.
- FR-03: The system must replace all holdings of the target portfolio with the holdings of the
  file when the user confirms the import, keeping the total cost of holdings whose ticker is
  still present.
- FR-04: The system must reject the whole import, applying no change, when the file is not a
  valid Balanz holdings CSV.
- FR-05: The system must not keep the uploaded file after the import is applied or cancelled.

## Non-Functional Requirements
- NFR-01: An import of a CSV file of up to 1 MB and 1,000 rows must produce its preview in < 5 s.
- NFR-02: 0 uploaded files must remain in any storage after an import is applied or cancelled.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user uploads a Balanz holdings CSV file for a portfolio, THE system SHALL
  read its holdings.
- AC-02 (FR-02): WHEN the file has been read, THE system SHALL show the holdings it will create,
  update and remove, before any change is applied.
- AC-03 (FR-03): WHEN a user confirms an import, THE system SHALL leave the portfolio with exactly
  the holdings of the file, with unit prices of source "import", and keep the total cost of
  holdings whose ticker was already present.
- AC-04 (FR-03): WHEN a user cancels an import at the preview, THE system SHALL leave the
  portfolio unchanged.
- AC-05 (FR-04): IF the uploaded file is not a valid Balanz holdings CSV, THEN THE system SHALL
  reject it with the reason and leave the portfolio unchanged.
- AC-06 (FR-05): WHEN an import is applied or cancelled, THE system SHALL delete the uploaded
  file.

## Out of Scope
- Storing broker credentials, scraping, or any login on behalf of the user (concept decision).
- Importing PDF files (fragile parsing); only CSV.
- Importing from brokers other than Balanz (a future PRD per broker).
- Official broker API integrations (IOL, others) — candidate for a future PRD.

## Risks and Mitigations
- **The Balanz CSV format is unknown and may change** → an anonymized sample file is required
  before PLAN; the importer sits behind one adapter; an unknown format is rejected whole, never
  partially applied (FR-04).
- **An import deletes holdings the user added by hand** → the preview lists what will be removed
  before confirming (AC-02); manual holdings belong in a separate portfolio.
- **Uploaded broker files contain sensitive data** → files are deleted after the import (FR-05,
  NFR-02).

## Dependencies
- DISC-001-07a (Portfolios, Holdings and Manual Valuation) — portfolios, holdings and prices.
- Balanz holdings CSV export (format to be confirmed with an anonymized sample file) — FR-01,
  FR-04.

## Decision Log
- 2026-09-25: Balanz exports PDF and CSV (user); import CSV only.
- 2026-09-25: User approved: import replaces the portfolio after preview keeping manual costs,
  uploaded file deleted. Pending before PLAN: anonymized Balanz CSV sample.
- 2026-10-01: Split from DISC-001-07 (user decision). Blocked until the sample file exists.
