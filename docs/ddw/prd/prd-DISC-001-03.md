# PRD DISC-001-03: Movements & Exchange Rates

| Field | Value |
|-------|-------|
| Ticket | DISC-001 |
| Tracker | none |
| Date | 2026-09-25 |
| PRD loops | 1 |
| Loops since last human decision | 0 |

## Context and Problem
Movements are the core of the finance PWA (see `docs/ddw/discovery/concept-DISC-001.md`): every
expense, income, transfer and dollar purchase changes an account balance (PRD 02). Users in
Argentina live in two currencies, and the ARS/USD rate moves constantly and has several
"official" values (oficial, blue, MEP…). Every movement therefore needs a frozen exchange rate,
so that converted totals and group balances do not change when the dollar moves.

## Goals
- Record expenses, income, transfers and currency exchanges quickly and correctly.
- Freeze on every expense and income the ARS/USD rate used, with its source, so history never
  changes.
- Keep an up-to-date local copy of market rates so entry never depends on an external service.
- Let users find their movements by account, category, date, type and tag.

## Functional Requirements
- FR-01: The system must allow a user to record an expense with an amount greater than 0, a
  date, one of their accounts, an expense category, an optional note and optional tags.
- FR-02: The system must allow a user to record an income with an amount greater than 0, a date,
  one of their accounts, an income category, an optional note and optional tags.
- FR-03: The system must allow a user to record a transfer of an amount greater than 0 between
  two different accounts of theirs with the same currency.
- FR-04: The system must allow a user to record a currency exchange: an amount taken out of one
  of their accounts in one currency and an amount put into one of their accounts in the other
  currency (decision 2026-09-25: buying/selling USD is not an expense nor an income).
- FR-05: The system must store on every currency exchange its implied rate, computed as the ARS
  amount divided by the USD amount.
- FR-06: The system must store on every expense and income the ARS-per-USD rate used to convert
  it to the other currency, and the source of that rate (automatic with its rate type, or
  manual).
- FR-07: The system must prefill the rate of a new expense or income with the latest stored sell
  price of the user's default rate type (PRD 01, FR-10).
- FR-08: The system must allow a user to replace the prefilled rate with a manual rate before
  saving the movement.
- FR-09: The system must keep the rate stored on a movement unchanged when market rates are
  updated.
- FR-10: The system must fetch the buy and sell prices of the 7 rate types (oficial, blue,
  bolsa/MEP, contado con liquidación, mayorista, cripto, tarjeta) from the rate provider and
  store them with their update timestamp.
- FR-11: The system must use the last stored rate when the rate provider does not answer, and
  must show the age of that rate on the entry form.
- FR-12: The system must update each account balance according to the movement type: an expense
  subtracts from its account, an income adds to its account, a transfer or currency exchange
  subtracts from the source account and adds to the destination account.
- FR-13: The system must allow a user to edit any field of one of their movements.
- FR-14: The system must allow a user to delete one of their movements.
- FR-15: The system must list the user's movements ordered by date, newest first.
- FR-16: The system must allow a user to filter the movement list by account, category, date
  range, movement type and tag, alone or combined.
- FR-17: The system must include the movements of a category's subcategories when the list is
  filtered by a parent category.
- FR-18: The system must allow a user to add up to 10 tags to an expense or income.
- FR-19: The system must suggest the user's existing tags while they type a tag.
- FR-20: The system must reject a movement with a date later than the current day in the user's
  time zone (PRD 01, FR-24) (future
  payments belong to PRD 08).
- FR-21: The system must let a user read, edit and delete only their own movements (movements
  shared through groups are governed by PRD 05).

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units (1 unit = 0.01 ARS or 0.01
  USD), with 0 floating-point columns or fields for money (concept decision).
- NFR-02: Exchange rates must be stored as integers scaled by 10,000 (4 decimal places), with 0
  floating-point columns or fields for rates.
- NFR-03: The system must refresh market rates every 60 minutes.
- NFR-04: Saving a movement must answer in < 300 ms at p95, measured server-side.
- NFR-05: Listing and filtering movements must answer in < 500 ms at p95 for a user with 100,000
  movements, measured server-side.
- NFR-06: The movement list must be paginated with a maximum page size of 100 items.
- NFR-07: Saving a movement must not call the rate provider synchronously: 0 provider calls in
  the request path of a movement save.
- NFR-08: Tags must be between 1 and 30 characters, and must be compared case-insensitively.

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
- AC-06 (FR-03): WHEN a user saves a transfer of an amount greater than 0 between two different
  accounts of theirs with the same currency, THE system SHALL store it.
- AC-07 (FR-03): IF a user saves a transfer whose source and destination are the same account or
  have different currencies, THEN THE system SHALL reject it.
- AC-08 (FR-04): WHEN a user saves a currency exchange of 1,557,300.00 ARS out of an ARS account
  and 1,000.00 USD into a USD account, THE system SHALL store it.
- AC-09 (FR-04): IF a user saves a currency exchange whose two accounts have the same currency,
  THEN THE system SHALL reject it.
- AC-10 (FR-05): WHEN a currency exchange of 1,557,300.00 ARS for 1,000.00 USD is saved, THE
  system SHALL store an implied rate of 1,557.3000 ARS per USD.
- AC-11 (FR-06): WHEN a user saves an expense or income, THE system SHALL store with it the rate
  used and its source ("automatic: <rate type>" or "manual").
- AC-12 (FR-07): WHEN a user opens the form of a new expense or income, THE system SHALL prefill
  the rate with the latest stored sell price of the user's default rate type.
- AC-13 (FR-08): WHEN a user replaces the prefilled rate with a manual rate greater than 0 and
  saves, THE system SHALL store that rate with source "manual".
- AC-14 (FR-08): IF a user enters a manual rate of 0 or less, THEN THE system SHALL reject it.
- AC-15 (FR-09): WHEN market rates are refreshed, THE system SHALL leave the rate stored on every
  existing movement unchanged.
- AC-16 (FR-10): WHEN a scheduled rate refresh succeeds, THE system SHALL store the buy price,
  sell price and update timestamp of each of the 7 rate types.
- AC-17 (FR-11): IF the rate provider fails or times out during a refresh, THEN THE system SHALL
  keep the last stored rates and record the failure.
- AC-18 (FR-11): WHILE the latest stored rate is older than 2 hours, THE system SHALL show its
  age on the entry form (for example "rate from 3 h ago").
- AC-19 (FR-12): WHEN an expense of 100.00 is saved on an account with a balance of 500.00, THE
  system SHALL show a balance of 400.00 for that account.
- AC-20 (FR-12): WHEN an income of 100.00 is saved on an account with a balance of 500.00, THE
  system SHALL show a balance of 600.00 for that account.
- AC-21 (FR-12): WHEN a transfer or currency exchange is saved, THE system SHALL subtract the
  source amount from the source account and add the destination amount to the destination
  account.
- AC-22 (FR-13): WHEN a user edits the amount, date, account, category, note, tags or rate of a
  movement and saves, THE system SHALL persist the change and recompute the balances of every
  account involved before and after the edit.
- AC-23 (FR-14): WHEN a user deletes a movement, THE system SHALL remove it and reverse its
  effect on every account balance involved.
- AC-24 (FR-15): WHEN a user opens the movement list, THE system SHALL show their movements
  ordered by date, newest first, in pages of at most 100.
- AC-25 (FR-16): WHEN a user filters by an account, a category, a date range, a movement type and
  a tag at once, THE system SHALL show only the movements that match all of them.
- AC-26 (FR-17): WHEN a user filters by a parent category, THE system SHALL include the
  movements of its subcategories.
- AC-27 (FR-18): WHEN a user saves an expense or income with between 1 and 10 tags, THE system
  SHALL store all of them.
- AC-28 (FR-18): IF a user adds an 11th tag to a movement, THEN THE system SHALL reject it.
- AC-29 (FR-19): WHEN a user types the first characters of a tag they already used, THE system
  SHALL suggest the matching existing tags.
- AC-30 (FR-20): IF a user saves a movement dated after the current day, THEN THE system SHALL
  reject it.
- AC-31 (FR-21): IF a user requests to read, edit or delete a movement owned by another user and
  not shared with them through a group, THEN THE system SHALL answer 404 Not Found and leave the
  movement unchanged.
- AC-32 (FR-21): WHEN a user opens the movement list, THE system SHALL show only movements they
  own.

## Out of Scope
- Offline entry and synchronization (PRD 04).
- Splitting movements between group members (PRD 05).
- Credit card statements and installment purchases (PRD 10).
- Future-dated and recurring movements (PRD 08).
- Receipt photos or file attachments (candidate for a future PRD).
- Currencies other than ARS and USD.
- Full-text search in notes.
- Bulk import of movements (CSV, bank statements).
- Splitting one movement across several categories.

## Risks and Mitigations
- **The rate provider (dolarapi.com) disappears or changes its API** → rates are stored locally
  (FR-10, FR-11) and the provider sits behind one adapter, so it can be replaced without touching
  movements.
- **Stale rates used without the user noticing** → the rate age is shown when older than 2 hours
  (AC-18).
- **Rounding errors in balances** → integer minor units and scaled integer rates (NFR-01,
  NFR-02).
- **Editing old movements changes past balances silently** → balances are recomputed on edit
  (AC-22); an audit trail of edits is out of this PRD and can be added if disputes appear in
  groups (PRD 05).

## Dependencies
- dolarapi.com (`/v1/dolares`), the external rate provider — FR-10, FR-11.
- PRD 01 (Identity & Access) — user default rate type (FR-07), user time zone (FR-20) and access
  control (FR-21).
- PRD 02 (Accounts & Categories) — accounts, currencies and categories (FR-01 to FR-04, FR-12,
  FR-17).
- PRD 05 (Groups & Expense Splitting) — movements shared through groups (FR-21).
- PRD 08 (Recurring Payments & Reminders) — future-dated payments (FR-20).

## Decision Log
- 2026-09-25: FX conversion automatic by default, editable per movement, default rate type per
  user and per group, rate frozen on each movement (concept).
- 2026-09-25: Buying/selling USD is a cross-currency transfer with its implied rate stored.
- 2026-09-25: Movements carry free tags; receipt photos deferred.
- 2026-09-25: User approved: sell price of the default rate type, 60-minute refresh with a
  2-hour staleness warning, no future dates, free editing without audit trail, up to 10 tags,
  rates with 4 decimals as scaled integers.
- 2026-09-25: User decision: per-user time zone, mandatory. Dates and scheduled times are
  computed in the user's time zone (PRD 01, FR-24).
