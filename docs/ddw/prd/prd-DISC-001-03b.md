# PRD DISC-001-03b: Expense and Income

| Field | Value |
|-------|-------|
| Ticket | DISC-001-03b |
| Tracker | none |
| Date | 2026-10-02 |
| PRD loops | 3 |
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
- FR-01: The system must allow a user to record an expense with an amount greater than 0, a date
  and time (the entry form defaults to the current moment and lets the user edit both), one of
  their accounts, an expense category and an optional note (tags: DISC-001-03d).
- FR-02: The system must allow a user to record an income with an amount greater than 0, a date
  and time, one of their accounts, an income category and an optional note (tags: DISC-001-03d).
- FR-03: The system must store on every expense and income the ARS-per-USD rate used to convert
  it to the other currency, and the source of that rate (automatic with its rate type, or
  manual).
- FR-04: The system must prefill the rate of a new expense or income with the latest stored sell
  price of the user's default rate type (PRD 01, FR-10), and must leave the rate empty and require a
  manual rate when no rate has ever been stored.
- FR-05: The system must allow a user to replace the prefilled rate with a manual rate before
  saving the movement.
- FR-06: The system must keep the rate stored on a movement unchanged when market rates are
  updated.
- FR-07: The system must update each account balance according to the movement type: an expense
  subtracts from its account and an income adds to its account.
- FR-08: The system must list the user's expenses and income ordered by date and time, newest first.
- FR-09: The system must reject a movement whose date, taken in the user's time zone (PRD 01,
  FR-24), is later than the current day (future payments belong to PRD 08); the date and time are
  stored as a UTC instant and shown in the user's time zone.
- FR-10: The system must let a user read only their own movements (movements shared through
  groups are governed by PRD 05).
- FR-11: The system must show the age of the stored rate on the entry form when it is older than
  2 hours.
- FR-12: The system must refuse to delete an account or a category that has movements.
- FR-13: The system must delete all of a user's movements, before the user, when the user is
  deleted (PRD 01, account deletion), in the same transaction as the deletion.
- FR-14: The system must include movements in the Available and Net worth totals of the account
  list (DISC-001-02a FR-10 and FEAT-003).
- FR-15: The system must reject an expense or income recorded on an archived account or in an
  archived category, and must tell the user to unarchive it first.
- FR-16: The system must limit the manual creation of movements to 60 per minute per user, and
  must not count movements that are created by a path other than manual entry (a future import).

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
- NFR-08: The counters of the creation limit must be stored in the database, with 0 counters kept
  in process memory (stateless API, PRD 01 NFR-09).

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user saves an expense with an amount greater than 0, a date and time, one
  of their accounts and an expense category, THE system SHALL store it and show it in the movement
  list.
- AC-02 (FR-01): IF a user saves an expense with an amount of 0 or less, THEN THE system SHALL
  reject it and show "Amount must be greater than 0".
- AC-03 (FR-01): IF a user saves an expense with an income category, THEN THE system SHALL
  reject it.
- AC-04 (FR-02): WHEN a user saves an income with an amount greater than 0, a date and time, one
  of their accounts and an income category, THE system SHALL store it and show it in the movement
  list.
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
  ordered by date and time, newest first, in pages of at most 100.
- AC-15 (FR-09): IF a user saves a movement whose date in the user's time zone is after the
  current day in that time zone, THEN THE system SHALL reject it.
- AC-16 (FR-10): IF a user requests to read a movement owned by another user and not shared with
  them through a group, THEN THE system SHALL answer 404 Not Found.
- AC-17 (FR-10): WHEN a user opens the movement list, THE system SHALL show only movements they
  own.
- AC-18 (FR-12): IF a user deletes an account that has at least one movement, THEN THE system
  SHALL reject the deletion with the existing "account has movements" error and keep the account
  and its movements.
- AC-19 (FR-12): IF a user deletes a category that is used by at least one movement, THEN THE
  system SHALL reject the deletion and offer to archive it instead.

- AC-20 (FR-04): WHEN a user opens the form of a new expense or income and no rate has ever been
  stored, THE system SHALL show the rate empty and require a manual rate.
- AC-21 (FR-04): IF a user saves an expense or income with no stored rate and no manual rate, THEN
  THE system SHALL reject it and store nothing.
- AC-22 (FR-13): WHEN a user who has movements, accounts and categories deletes their account, THE
  system SHALL delete the user's movements before the user, and no row of that user SHALL remain
  in the movements, accounts or categories tables.
- AC-23 (FR-13): IF deleting the movements of a user fails, THEN THE system SHALL roll back the
  whole deletion and keep the user, their accounts and their movements.
- AC-24 (FR-14): WHEN an expense of 100.00 is saved on an included account with a balance of
  500.00, THE system SHALL show Available and Net worth totals that are 100.00 lower than before
  the expense.

- AC-25 (FR-15): IF a user saves a movement on an archived account, THEN THE system SHALL reject
  it, store nothing and tell the user to unarchive the account first.
- AC-26 (FR-15): IF a user saves a movement in an archived category, THEN THE system SHALL reject
  it, store nothing and tell the user to unarchive the category first.
- AC-27 (FR-15): WHEN a user unarchives an account or category that had refused a movement, THE
  system SHALL accept a movement on it again.
- AC-28 (FR-16): IF a user creates a 61st movement by manual entry within one minute, THEN THE
  system SHALL reject it with a 429 answer that states when to retry, and store no movement beyond
  the 60th of that minute.
- AC-29 (FR-16): WHEN the minute of a user's limit has passed, THE system SHALL accept manual
  creation again.
- AC-30 (FR-16): WHILE movements are created by a path other than manual entry, THE system SHALL
  NOT count them toward the limit of 60 per minute.
- AC-31 (FR-01): WHEN a user opens the entry form of a new expense or income, THE system SHALL show
  the date and time defaulted to the current moment in the user's time zone and let the user edit
  both.

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
- Bulk import of movements (CSV, bank statements, Excel): a future ticket, which must bypass the creation limit (AC-30).
- A cap on the total number of movements per user.
- Splitting one movement across several categories.

## Risks and Mitigations
- **Stale rates used without the user noticing** → the rate age is shown when older than 2 hours
  (AC-11).
- **Rounding errors in balances** → integer minor units and scaled integer rates (NFR-01, NFR-02).
- **Balance slows down as movements grow** → NFR-06 sets the budget and the perf test of
  DISC-001-02a is re-run against the real adapter.
- **Deleting a user conflicts with the restricting keys that protect accounts and categories** →
  decided (2026-10-02): the keys stay ON DELETE RESTRICT and user deletion erases the user's
  movements first through an ordered erasure step (FR-13), with the policy value of the
  DISC-001-01f erasure guard.
- **No stored rate exists yet** → decided (2026-10-02): the form requires a manual rate (FR-04,
  AC-20, AC-21).
- **Writing a movement on an archived account or category** → decided (2026-10-02): rejected
  (FR-15, AC-25 to AC-27).
- **A client or script floods the creation route** → a per-user limit of 60 per minute (FR-16,
  AC-28 to AC-30) stored in the database (NFR-08), with no cap on the total.

## Dependencies
- DISC-001-03a (Exchange Rates, Store and Sync) — the stored rates to prefill (FR-04, FR-11).
- PRD 01 (Identity & Access) — user default rate type (FR-04), user time zone (FR-09) and access
  control (FR-10, NFR-07).
- PRD 02 (Accounts & Categories) — accounts, currencies and expense and income categories
  (FR-01, FR-02, FR-07, FR-12, FR-14): DISC-001-02a, DISC-001-02b and FEAT-003 (all merged).
- DISC-001-01f (Account Deletion) — the erasure transaction and the erasure guard that the ordered step of FR-13 joins.
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
- 2026-10-02: Human decision (relayed by the orchestrator), no rate stored yet: when no rate has ever
  been stored, the entry form of an expense or income REQUIRES a manual rate, and that rate is frozen
  on the movement with source "manual". To be folded into FR-04, FR-05 and their ACs when this ticket
  starts its DEFINE.
- 2026-10-02: Human decision (relayed by the orchestrator), user deletion versus restricting keys: the
  foreign keys from movements to accounts and to categories keep ON DELETE RESTRICT (as DISC-001-02a and
  DISC-001-02b require); deleting a user erases that user's movements FIRST, through an ordered erasure
  step plus the policy value of the DISC-001-01f erasure guard, both added by this ticket. The
  PostgreSQL ordering behavior is proven by a test in this ticket's PLAN.
- 2026-10-02: Human decision (relayed by the orchestrator), merge order: this ticket waits for
  DISC-001-02b to be merged into main; no stacked branch.
- 2026-10-02: DISC-001-02a deferrals discharged by this ticket's tests: AC-10 end to end, the
  history half of AC-07, NFR-01 and NFR-02 against the real table. DISC-001-02b deferrals: AC-05
  (renamed category shown on existing movements), AC-06 (archived category kept on movements) and
  AC-10 end to end.
- 2026-10-02: DEFINE of this ticket (human decisions already on record folded into the requirements):
  FR-04 now carries "when no rate has ever been stored, the form requires a manual rate" with AC-20 and
  AC-21; the ordered erasure step is FR-13 with AC-22 and AC-23; the ON DELETE RESTRICT keys of FR-12
  stay. FR-14 and AC-24 (movements count in the Available and Net worth totals) are not in the original
  text: they follow from FEAT-003 and the real AccountMovements adapter, and are listed here as added
  while defining.
- 2026-10-02: Human decision Q1 (relayed by the orchestrator): the rate age of FR-11 and AC-11 is
  measured from the time of our own refresh (`fetchedAt`), not from the provider's update time.
- 2026-10-02: Human decision Q2: a movement on an archived account or category is rejected by the API
  (account: the existing ACCOUNT_ARCHIVED 409 with its own message; category: a new CATEGORY_ARCHIVED
  409) and the screen tells the user to unarchive first: FR-15, AC-25 to AC-27.
- 2026-10-02: Human decision Q3: the caps (amount at most 10^15 minor units, note at most 500
  characters), RATE_REQUIRED as a 400 and the read route GET /movements/:id are confirmed. CHANGED: a
  movement stores DATE AND TIME as a UTC instant, shown in the user's time zone, and the entry form
  defaults to the current moment and is editable (FR-01, FR-02, FR-08, FR-09, AC-01, AC-04, AC-14,
  AC-15, AC-31). The rule "no movement after the current day in the user's time zone" is kept on the
  date taken in that zone (AC-15), which allows a later time on the same day; whether a later time
  today should also be refused is raised as an open question and not decided here.
- 2026-10-02: Human decision Q4: manual movement creation is limited to 60 per minute per user, a
  rejected excess answers 429 with a retry time, the counters are stored in the database, bulk import
  (for example from Excel, a future ticket with no PRD yet) must not count against it, and the limit
  is not a cap on the total number of movements: FR-16, NFR-08, AC-28 to AC-30.
