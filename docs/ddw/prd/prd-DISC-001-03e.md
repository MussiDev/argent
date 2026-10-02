# PRD DISC-001-03e: Edit and Delete Movements

| Field | Value |
|-------|-------|
| Ticket | DISC-001-03e |
| Tracker | none |
| Date | 2026-10-02 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Fifth sub-ticket of Movements & Exchange Rates (parent index: `prd-DISC-001-03.md`). People make
typos and change their minds, so every movement must be editable and removable, and the balances
must follow. Editing is free and leaves no audit trail (user decision 2026-09-25). Split from
`prd-DISC-001-03.md` (2026-10-02, user decision). Requirement IDs were renumbered; the parent index
maps every original ID to its new one.

## Goals
- Let users correct or remove any of their movements.
- Keep every account balance consistent after an edit or a deletion.

## Functional Requirements
- FR-01: The system must allow a user to edit any field of one of their movements.
- FR-02: The system must allow a user to delete one of their movements.
- FR-03: The system must let a user edit and delete only their own movements (movements shared
  through groups are governed by PRD 05).
- FR-04: The system must reject an edit that sets a date later than the current day in the user's
  time zone (PRD 01, FR-24).

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units, with 0 floating-point columns
  or fields for money.
- NFR-02: Exchange rates must be stored as integers scaled by 10,000, with 0 floating-point
  columns or fields for rates.
- NFR-03: Saving an edited movement and deleting a movement must each answer in < 300 ms at p95,
  measured server-side.
- NFR-04: 100% of queries that edit or delete a movement must be filtered by the owner (PRD 01,
  FR-23).

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user edits the amount, date, account, category, note, tags or rate of a
  movement and saves, THE system SHALL persist the change and recompute the balances of every
  account involved before and after the edit.
- AC-02 (FR-02): WHEN a user deletes a movement, THE system SHALL remove it and reverse its effect
  on every account balance involved.
- AC-03 (FR-03): IF a user requests to edit or delete a movement owned by another user and not
  shared with them through a group, THEN THE system SHALL answer 404 Not Found and leave the
  movement unchanged.
- AC-04 (FR-04): IF a user edits a movement to a date after the current day, THEN THE system SHALL
  reject the edit and leave the movement unchanged.
- AC-05 (FR-01): IF a user edits the amount of a movement to 0 or less, THEN THE system SHALL
  reject the edit and leave the movement unchanged.

## Out of Scope
- An audit trail of edits (can be added if disputes appear in groups, PRD 05).
- Undoing a deletion.
- Editing or deleting movements shared through groups (PRD 05).
- Editing the rate stored on past movements in bulk.

## Risks and Mitigations
- **Editing old movements changes past balances silently** → balances are recomputed on edit
  (AC-01); an audit trail is out of this PRD.
- **An edit that moves a movement between accounts leaves one balance wrong** → AC-01 requires
  recomputing every account involved before and after.

## Dependencies
- DISC-001-03b (Expense and Income), DISC-001-03c (Transfers and Currency Exchange) and
  DISC-001-03d (Tags and Filters) — every movement type and the tags that can be edited.
- PRD 01 (Identity & Access) — user time zone (FR-04) and access control (FR-03, NFR-04).
- PRD 02 (Accounts & Categories) — accounts whose balances are recomputed (FR-01, FR-02).
- PRD 05 (Groups & Expense Splitting) — movements shared through groups (FR-03).

## Decision Log
- 2026-09-25: User approved: free editing without an audit trail.
- 2026-10-02: Parent PRD split into DISC-001-03a to 03e by user decision.
- 2026-10-02: FR-04, AC-04 and AC-05 apply the original FR-20 and AC-02 to edits; NFR-03 extends
  the original NFR-04 (saving) to deletion; NFR-04 is the owner-scope rule of AGENTS.md. Not in the
  original text; listed in the parent index as added while splitting.
