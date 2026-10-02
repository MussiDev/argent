# PRD DISC-001-03b: Expense and Income

| Field | Value |
|-------|-------|
| Ticket | DISC-001-03b |
| Tracker | none |
| Date | 2026-10-02 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Second sub-ticket of Movements & Exchange Rates (parent index: `prd-DISC-001-03.md`). Expenses and
income are the core of the finance PWA (see `docs/ddw/discovery/concept-DISC-001.md`): they change
an account balance, and each one freezes the ARS/USD rate used, so that converted totals and group
balances do not change when the dollar moves. This ticket also supplies the real movements side of
the ports that accounts and categories left open (`AccountMovements` of DISC-001-02a and
`CategoryUsage` of DISC-001-02b) and discharges their deferred end-to-end tests. Split from
`prd-DISC-001-03.md` (2026-10-02, user decision). Requirement IDs were renumbered; the parent index
maps every original ID to its new one.

## Goals
- Record expenses and income quickly and correctly, with a frozen rate and its source.
- Make account balances real: balance = opening balance plus the sum of movements.
- Keep the history intact: an account or category with movements cannot be deleted.
- List the user's movements, newest first.

## Functional Requirements
- FR-01: The system must allow a user to record an expense with an amount greater than 0, a date,
  one of their accounts, an expense category and an optional note (tags: DISC-001-03d).
- FR-02: The system must allow a user to record an income with an amount greater than 0, a date,
  one of their accounts, an income category and an optional note (tags: DISC-001-03d).
- FR-03: The system must store on every expense and income the ARS-per-USD rate used to convert
  it to the other currency, and the source of that rate (automatic with its rate type, or
  manual).
- FR-04: The system must prefill the rate of a new expense or income with the latest stored sell
  price of the user's default rate type (PRD 01, FR-10).
- FR-05: The system must allow a user to replace the prefilled rate with a manual rate before
  saving the movement.
- FR-06: The system must keep the rate stored on a movement unchanged when market rates are
  updated.
- FR-07: The system must update each account balance according to the movement type: an expense
  subtracts from its account and an income adds to its account.
- FR-08: The system must list the user's expenses and income ordered by date, newest first.
- FR-09: The system must reject a movement with a date later than the current day in the user's
  time zone (PRD 01, FR-24) (future payments belong to PRD 08).
- FR-10: The system must let a user read only their own movements (movements shared through
  groups are governed by PRD 05).
- FR-11: The system must show the age of the stored rate on the entry form when it is older than
  2 hours.
- FR-12: The system must refuse to delete an account or a category that has movements.

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units (1 unit = 0.01 ARS or 0.01
  USD), with 0 floating-point columns or fields for money (concept decision).
- NFR-02: Exchange rates stored on movements must be integers scaled by 10,000 (4 decimal
  places), with 0 floating-point columns or fields for rates.
- NFR-03: Saving a movement must answer in < 300 ms at p95, measured server-side.
- NFR-04: The movement list must be paginated with a maximum page size of 100 items.
- NFR-05: Saving a movement must not call the rate provider synchronously: 0 provider calls in
  the request path of a movement save.
- NFR-06: Listing accounts with their balances must answer in < 300 ms at p95 for a user with 100
  accounts and 100,000 movements, measured server-side (keeps DISC-001-02a NFR-02, now against the
  real movements table).
- NFR-07: Every movement must belong to exactly one user, and 100% of queries on movements must
  be filtered by the owner (PRD 01, FR-23).

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user saves an expense with an amount greater than 0, a date, one of their
  accounts and an expense category, THE system SHALL store it and show it in the movement list.
- AC-02 (FR-01): IF a user saves an expense with an amount of 0 or less, THEN THE system SHALL
  reject it and show "Amount must be greater than 0".
- AC-03 (FR-01): IF a user saves an expense with an income category, THEN THE system SHALL
  reject it.
- AC-04 (FR-02): WHEN a user saves an income with an amount greater than 0, a date, one of their
  accounts and an income category, THE system SHALL store it and show it in the movement list.
- AC-05 (FR-02): IF a user saves an income with an expense category, THEN THE system SHALL
  reject it.
- AC-06 (FR-03): WHEN a user saves an expense or income, THE system SHALL store with it the rate
  used and its source ("automatic: <rate type>" or "manual").
- AC-07 (FR-04): WHEN a user opens the form of a new expense or income, THE system SHALL prefill
  the rate with the latest stored sell price of the user's default rate type.
- AC-08 (FR-05): WHEN a user replaces the prefilled rate with a manual rate greater than 0 and
  saves, THE system SHALL store that rate with source "manual".
- AC-09 (FR-05): IF a user enters a manual rate of 0 or less, THEN THE system SHALL reject it.
- AC-10 (FR-06): WHEN market rates are refreshed, THE system SHALL leave the rate stored on every
  existing movement unchanged.
- AC-11 (FR-11): WHILE the latest stored rate is older than 2 hours, THE system SHALL show its
  age on the entry form (for example "rate from 3 h ago").
- AC-12 (FR-07): WHEN an expense of 100.00 is saved on an account with a balance of 500.00, THE
  system SHALL show a balance of 400.00 for that account.
- AC-13 (FR-07): WHEN an income of 100.00 is saved on an account with a balance of 500.00, THE
  system SHALL show a balance of 600.00 for that account.
- AC-14 (FR-08): WHEN a user opens the movement list, THE system SHALL show their movements
  ordered by date, newest first, in pages of at most 100.
- AC-15 (FR-09): IF a user saves a movement dated after the current day, THEN THE system SHALL
  reject it.
- AC-16 (FR-10): IF a user requests to read a movement owned by another user and not shared with
  them through a group, THEN THE system SHALL answer 404 Not Found.
- AC-17 (FR-10): WHEN a user opens the movement list, THE system SHALL show only movements they
  own.
- AC-18 (FR-12): IF a user deletes an account that has at least one movement, THEN THE system
  SHALL reject the deletion with the existing "account has movements" error and keep the account
  and its movements.
- AC-19 (FR-12): IF a user deletes a category that is used by at least one movement, THEN THE
  system SHALL reject the deletion and offer to archive it instead.

## Out of Scope
- Transfers and currency exchanges (DISC-001-03c).
- Tags and filters on the list (DISC-001-03d).
- Editing and deleting movements (DISC-001-03e).
- Fetching and storing market rates (DISC-001-03a).
- Offline entry and synchronization (PRD 04).
- Splitting movements between group members (PRD 05).
- Credit card statements and installment purchases (PRD 10).
- Future-dated and recurring movements (PRD 08).
- Receipt photos or file attachments.
- Currencies other than ARS and USD.
- Bulk import of movements (CSV, bank statements).
- Splitting one movement across several categories.

## Risks and Mitigations
- **Stale rates used without the user noticing** → the rate age is shown when older than 2 hours
  (AC-11).
- **Rounding errors in balances** → integer minor units and scaled integer rates (NFR-01, NFR-02).
- **Balance slows down as movements grow** → NFR-06 sets the budget and the perf test of
  DISC-001-02a is re-run against the real adapter.
- **Deleting a user conflicts with the restricting keys that protect accounts and categories** →
  decided in this ticket's PLAN (see the parent index, pending decisions); it must not break the
  erasure guard of DISC-001-01f.
- **No stored rate exists yet** → undefined in the original text; listed as a pending decision
  in the parent index and resolved before this ticket's spec.

## Dependencies
- DISC-001-03a (Exchange Rates, Store and Sync) — the stored rates to prefill (FR-04, FR-11).
- PRD 01 (Identity & Access) — user default rate type (FR-04), user time zone (FR-09) and access
  control (FR-10, NFR-07).
- PRD 02 (Accounts & Categories) — accounts, currencies and expense and income categories
  (FR-01, FR-02, FR-07, FR-12): DISC-001-02a (merged) and DISC-001-02b (must be merged first).
- PRD 05 (Groups & Expense Splitting) — movements shared through groups (FR-10).
- PRD 08 (Recurring Payments & Reminders) — future-dated payments (FR-09).

## Decision Log
- 2026-09-25: FX conversion automatic by default, editable per movement, default rate type per
  user and per group, rate frozen on each movement (concept).
- 2026-09-25: User approved: sell price of the default rate type, 2-hour staleness warning, no
  future dates, rates with 4 decimals as scaled integers.
- 2026-09-25: User decision: per-user time zone, mandatory (PRD 01, FR-24).
- 2026-10-02: Parent PRD split into DISC-001-03a to 03e by user decision.
- 2026-10-02: FR-12, AC-18, AC-19, NFR-06 and NFR-07 are not in the original movements text: they
  carry the obligations that DISC-001-02a and DISC-001-02b deferred to PRD 03 (real adapters,
  foreign keys with ON DELETE RESTRICT, the 100,000-movement performance test) and the owner-scope
  rule of AGENTS.md. Listed in the parent index as added while splitting.
- 2026-10-02: DISC-001-02a deferrals discharged by this ticket's tests: AC-10 end to end, the
  history half of AC-07, NFR-01 and NFR-02 against the real table. DISC-001-02b deferrals: AC-05
  (renamed category shown on existing movements), AC-06 (archived category kept on movements) and
  AC-10 end to end.
