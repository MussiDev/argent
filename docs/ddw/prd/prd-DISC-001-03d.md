# PRD DISC-001-03d: Tags and Filters

| Field | Value |
|-------|-------|
| Ticket | DISC-001-03d |
| Tracker | none |
| Date | 2026-10-02 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Fourth sub-ticket of Movements & Exchange Rates (parent index: `prd-DISC-001-03.md`). A long
history is useless if the user cannot find things in it. Users need free tags on expenses and
income, suggestions of the tags they already use, and a list they can narrow by account, category,
date, type and tag. Split from `prd-DISC-001-03.md` (2026-10-02, user decision). Requirement IDs
were renumbered; the parent index maps every original ID to its new one.

## Goals
- Let users label expenses and income with their own tags.
- Let users find their movements by account, category, date range, type and tag.

## Functional Requirements
- FR-01: The system must allow a user to add up to 10 tags to an expense or income.
- FR-02: The system must suggest the user's existing tags while they type a tag.
- FR-03: The system must allow a user to filter the movement list by account, category, date
  range, movement type and tag, alone or combined.
- FR-04: The system must include the movements of a category's subcategories when the list is
  filtered by a parent category.

## Non-Functional Requirements
- NFR-01: Listing and filtering movements must answer in < 500 ms at p95 for a user with 100,000
  movements, measured server-side.
- NFR-02: The filtered movement list must be paginated with a maximum page size of 100 items.
- NFR-03: Tags must be between 1 and 30 characters, and must be compared case-insensitively.
- NFR-04: Every tag must belong to exactly one user, and 100% of queries on tags must be filtered
  by the owner (PRD 01, FR-23).

## Acceptance Criteria
- AC-01 (FR-03): WHEN a user filters by an account, a category, a date range, a movement type and
  a tag at once, THE system SHALL show only the movements that match all of them.
- AC-02 (FR-04): WHEN a user filters by a parent category, THE system SHALL include the movements
  of its subcategories.
- AC-03 (FR-01): WHEN a user saves an expense or income with between 1 and 10 tags, THE system
  SHALL store all of them.
- AC-04 (FR-01): IF a user adds an 11th tag to a movement, THEN THE system SHALL reject it.
- AC-05 (FR-02): WHEN a user types the first characters of a tag they already used, THE system
  SHALL suggest the matching existing tags.
- AC-06 (FR-01): IF a user saves a tag that is empty or longer than 30 characters, THEN THE system
  SHALL reject it.
- AC-07 (FR-03): IF a user filters by an account, a category or a tag that belongs to another
  user, THEN THE system SHALL show no movements of that user and reveal nothing about the other
  user's data.

## Out of Scope
- Editing or removing the tags of an existing movement (DISC-001-03e).
- Tags on transfers and currency exchanges.
- Full-text search in notes.
- Tags shared between users or defined per group (PRD 05).
- Renaming or merging tags.

## Risks and Mitigations
- **The list slows down with 100,000 movements** → NFR-01 sets the budget and the perf test
  proves it with combined filters.
- **Two spellings of the same tag split the history** → tags are compared case-insensitively
  (NFR-03); how a tag is displayed when spellings differ is a spec decision.

## Dependencies
- DISC-001-03b (Expense and Income) — the movements, list and pagination.
- PRD 02 (Accounts & Categories) — accounts, categories and subcategories to filter by (FR-03,
  FR-04): DISC-001-02b must be merged.
- PRD 01 (Identity & Access) — access control (AC-07, NFR-04).

## Decision Log
- 2026-09-25: Movements carry free tags; up to 10 tags (user approved).
- 2026-10-02: Parent PRD split into DISC-001-03a to 03e by user decision.
- 2026-10-02: AC-06 applies NFR-03 (original NFR-08) as a sad path and AC-07 applies the
  owner-scope rule of AGENTS.md to filters; NFR-04 is the owner-scope rule. Not in the original
  text; listed in the parent index as added while splitting.
