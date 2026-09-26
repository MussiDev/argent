# PRD DISC-001-10: Credit Cards: Statements & Installments

| Field | Value |
|-------|-------|
| Ticket | DISC-001 |
| Tracker | none |
| Date | 2026-09-25 |
| PRD loops | 2 |
| Loops since last human decision | 0 |

## Context and Problem
In Argentina the credit card is the main payment method, and it works in a way a plain account
cannot model: purchases are grouped into monthly statements by a closing date, paid by a due
date, split into installments ("12 cuotas sin interés") that land on future statements, and
billed in two currencies (ARS and USD) on the same statement. Users of the finance PWA (see
`docs/ddw/discovery/concept-DISC-001.md`) need to know how much each statement will be, how much
debt is committed in future installments, and to see each installment as spending in the month
they actually pay it. PRD 02 declared the credit card account type and left its behavior to this
PRD.

## Goals
- Model each card with statement cycles: closing date and due date, editable per statement.
- Record installment purchases and spread them over future statements.
- Count each installment as spending in the month of its statement (decision 2026-09-25: cash-flow
  view, the usual one in Argentina).
- Handle ARS and USD balances of the same card without breaking "one currency per account"
  (PRD 02): two linked accounts per card, chosen automatically (decision 2026-09-25).
- Support manual statement payments and optional automatic debit (decision 2026-09-25, based on
  Money Manager's billing account model).

## Functional Requirements
- FR-01: The system must allow a user to create a credit card with a name, a default closing day
  of the month and a default due day of the month.
- FR-02: The system must create, for every new credit card, two linked accounts of type credit
  card (PRD 02): one in ARS and one in USD, named "<card name> ARS" and "<card name> USD".
- FR-03: The system must assign an expense recorded on a credit card to the linked account whose
  currency matches the currency the user chose for the expense.
- FR-04: The system must create for every card one statement per monthly cycle, with a closing
  date on the card's default closing day and a due date on the first occurrence of the card's
  default due day after that closing date.
- FR-23: The system must use the last day of the month when a card's default closing or due day
  does not exist in that month (for example the 31st in February).
- FR-05: The system must allow a user to change the closing date and the due date of a statement
  that is not yet closed.
- FR-06: The system must allow a user to change the default closing and due days of a card, with
  effect on statements not yet closed.
- FR-07: The system must consider a statement closed once its closing date has ended in the
  user's time zone (PRD 01, FR-24).
- FR-08: The system must assign a purchase dated on or before a statement's closing date to that
  statement, and a purchase dated after it to the next statement.
- FR-09: The system must allow a user to record an installment purchase on a card with a total
  amount in ARS and a number of installments from 2 to 60.
- FR-10: The system must reject installment purchases in USD.
- FR-11: The system must split an installment purchase into equal installments, assigning the
  minor units left over to the first installment.
- FR-12: The system must assign the first installment to the statement of the purchase date and
  each following installment to the next statement.
- FR-13: The system must count each installment as an expense of the purchase's category in the
  month of its statement's due date, for reports (PRD 09) and budgets (PRD 06).
- FR-14: The system must show, for each statement, its total per currency: the sum of the
  purchases and installments assigned to it.
- FR-15: The system must show, for each card, its pending debt: the sum of the installments
  assigned to statements that are not yet closed, per currency.
- FR-16: The system must allow a user to record a statement payment as a transfer (PRD 03) of an
  amount greater than 0 from one of their accounts to the card's linked account of the same
  currency.
- FR-17: The system must show, for each closed statement and currency, its status: paid when
  payments cover the total, partially paid when they cover part of it, unpaid when there are
  none.
- FR-18: The system must allow a user to link to a card an optional automatic debit account per
  currency, chosen among their accounts of that currency.
- FR-19: The system must record on a statement's due date, for each currency with an automatic
  debit account, a transfer of the unpaid remainder of that currency from the debit account to
  the card's linked account.
- FR-20: The system must send a reminder of each statement's due date, through the channels of
  PRD 08, a configurable number of days before (0 to 30, default 3).
- FR-21: The system must allow a user to delete an installment purchase, removing the
  installments assigned to statements not yet closed and keeping the ones in closed statements.
- FR-22: The system must let a user read, edit and delete only their own cards, statements and
  installment purchases.

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units, with 0 floating-point columns
  or fields for money (concept decision).
- NFR-02: The statement view must answer in < 300 ms at p95 for a card with 60 active installment
  purchases, measured server-side.
- NFR-03: Automatic debits must be recorded between 06:00 and 06:15 of the due date, in the user's
  time zone.
- NFR-04: The automatic debit job must be idempotent: running it any number of times for the same
  day must produce 0 duplicate transfers.
- NFR-05: For every installment purchase, the sum of its installments must equal its total amount
  exactly (difference of 0 minor units), verified by an automated test over 10,000 random
  purchases.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user creates a card "Visa" with closing day 24 and due day 5, THE system
  SHALL store it and show it in the card list.
- AC-02 (FR-01): IF a user creates a card with a closing or due day outside 1 to 31, THEN THE
  system SHALL reject it.
- AC-03 (FR-02): WHEN a card "Visa" is created, THE system SHALL create the credit card accounts
  "Visa ARS" in ARS and "Visa USD" in USD, linked to it.
- AC-04 (FR-03): WHEN a user records an expense of 15.99 USD on card "Visa", THE system SHALL
  record it on the account "Visa USD".
- AC-05 (FR-04): WHEN a card with closing day 24 and due day 5 has its October 2026 cycle created,
  THE system SHALL set its closing date to 2026-10-24 and its due date to 2026-11-05.
- AC-06 (FR-05): WHEN a user moves the closing date of an open statement from 2026-10-24 to
  2026-10-26, THE system SHALL persist it and reassign the purchases dated 2026-10-25 and
  2026-10-26 to that statement.
- AC-07 (FR-05): IF a user tries to change the dates of a closed statement, THEN THE system SHALL
  reject it.
- AC-08 (FR-06): WHEN a user changes a card's default closing day from 24 to 20, THE system SHALL
  use day 20 for statements not yet closed and leave closed statements unchanged.
- AC-09 (FR-07): WHEN the closing date 2026-10-24 ends in the user's time zone, THE system SHALL
  mark that statement as closed.
- AC-10 (FR-08): WHEN a purchase dated 2026-10-24 is recorded on a card whose statement closes on
  2026-10-24, THE system SHALL assign it to that statement.
- AC-11 (FR-08): WHEN a purchase dated 2026-10-25 is recorded on that card, THE system SHALL
  assign it to the next statement.
- AC-12 (FR-09): WHEN a user records a purchase of 120,000.00 ARS in 12 installments, THE system
  SHALL store it with 12 installments.
- AC-13 (FR-09): IF a user records an installment purchase with fewer than 2 or more than 60
  installments, THEN THE system SHALL reject it.
- AC-14 (FR-10): IF a user records an installment purchase in USD, THEN THE system SHALL reject
  it.
- AC-15 (FR-11): WHEN a purchase of 100.00 ARS is split into 3 installments, THE system SHALL
  create installments of 33.34, 33.33 and 33.33 ARS.
- AC-16 (FR-12): WHEN a purchase in 3 installments is assigned to the statement closing on
  2026-10-24, THE system SHALL assign its installments to the statements closing on 2026-10-24,
  2026-11-24 and 2026-12-24.
- AC-17 (FR-13): WHEN an installment of 10,000.00 ARS belongs to a statement due on 2026-11-05,
  THE system SHALL count 10,000.00 ARS as an expense of the purchase's category in November 2026
  and SHALL not count the rest of the purchase in that month.
- AC-18 (FR-14): WHEN a statement has purchases of 50,000.00 ARS and 20.00 USD and an installment
  of 10,000.00 ARS, THE system SHALL show totals of 60,000.00 ARS and 20.00 USD.
- AC-19 (FR-15): WHEN a card has 11 installments of 10,000.00 ARS in statements not yet closed,
  THE system SHALL show a pending debt of 110,000.00 ARS.
- AC-20 (FR-16): WHEN a user records a payment of 60,000.00 ARS from their bank account to "Visa
  ARS", THE system SHALL subtract it from the bank account and add it to "Visa ARS", without
  counting it as an expense.
- AC-21 (FR-16): IF a user records a statement payment from an account whose currency differs
  from the card account's currency, THEN THE system SHALL reject it.
- AC-22 (FR-17): WHEN a closed statement of 60,000.00 ARS has payments of 60,000.00 ARS, THE
  system SHALL show it as paid in ARS.
- AC-23 (FR-17): WHEN a closed statement of 60,000.00 ARS has payments of 20,000.00 ARS, THE
  system SHALL show it as partially paid in ARS.
- AC-24 (FR-18): WHEN a user links an ARS bank account as automatic debit account for ARS, THE
  system SHALL persist the link and show it on the card.
- AC-25 (FR-18): IF a user links as automatic debit account an account whose currency differs
  from the one it is linked for, THEN THE system SHALL reject it.
- AC-26 (FR-19): WHEN the due date of a statement with an unpaid ARS remainder of 40,000.00 ARS
  arrives and the card has an ARS debit account, THE system SHALL record a transfer of 40,000.00
  ARS from the debit account to the card's ARS account.
- AC-27 (FR-19): WHILE a card has no automatic debit account for a currency, THE system SHALL
  record no automatic payment in that currency.
- AC-28 (FR-20): WHEN a statement is due on 2026-11-05 and the card has 3 reminder days, THE system
  SHALL send its reminder on 2026-11-02.
- AC-29 (FR-21): WHEN a user deletes a purchase in 12 installments after 2 statements have closed,
  THE system SHALL remove the 10 installments of statements not yet closed and keep the 2 in the
  closed statements.
- AC-30 (FR-22): IF a user requests to read, edit or delete a card, statement or installment
  purchase owned by another user, THEN THE system SHALL answer 404 Not Found and leave it
  unchanged.
- AC-31 (FR-22): WHEN a user opens their card list, THE system SHALL show only their own cards.
- AC-32 (FR-23): WHEN a card has closing day 31, THE system SHALL set the closing date of its
  February 2027 statement to 2027-02-28.

## Out of Scope
- Credit limit and available credit.
- Early cancellation of installments (precancelación).
- Installments with interest and installment plans in USD.
- Automatic calculation of interest, fees or taxes (the user records them as expenses).
- Paying a group expense in installments.
- Importing card statements or connecting to banks (no credentials are stored, concept decision).
- Additional cards (extensiones) and cards shared between users.
- Minimum payment calculation.
- Converting the USD balance to ARS at payment time (each currency is paid from an account in
  that currency).

## Risks and Mitigations
- **Banks move closing and due dates around holidays** → dates editable per open statement
  (FR-05).
- **The user picks the wrong currency account for a card expense** → the app chooses the linked
  account from the expense currency (FR-03).
- **Double counting installments in reports** → only each installment counts, in its statement's
  month (FR-13, AC-17).
- **Automatic debit records a payment the bank did not make** (insufficient funds) → the user can
  edit or delete the transfer (PRD 03); the debit is opt-in per currency (FR-18).
- **Rounding makes installments not add up** → leftover to the first installment and exact-sum
  invariant (FR-11, NFR-05).

## Dependencies
- PRD 01 (Identity & Access) — user time zone (FR-07) and access control (FR-22).
- PRD 02 (Accounts & Categories) — credit card account type and categories (FR-02, FR-13).
- PRD 03 (Movements & Exchange Rates) — expenses and transfers (FR-03, FR-16, FR-19).
- PRD 06 (Savings Goals & Budgets) — budgets receive installments by statement month (FR-13).
- PRD 08 (Recurring Payments & Reminders) — reminder channels and scheduling (FR-20, NFR-03).
- PRD 09 (Dashboard & Reports) — reports receive installments by statement month (FR-13).

## Decision Log
- 2026-09-25: Credit cards modeled with statement cycles and installments in their own PRD
  (concept).
- 2026-09-25: Each installment counts as spending in the month of its statement (cash flow).
- 2026-09-25: Two linked accounts per card (ARS and USD), chosen automatically from the expense
  currency, keeping "one currency per account" from PRD 02.
- 2026-09-25: Design reviewed against Money Manager (Realbyte) and Argentine bank documentation:
  closing/due dates editable per statement, purchase assignment by closing date, 2–60 ARS
  installments with leftover to the first one, manual payments by transfer, no interest
  calculation, statement reminders via PRD 08, optional automatic debit per currency.
- 2026-09-25: User approved: automatic debit per currency (no USD-to-ARS conversion), debit pays
  the unpaid remainder at 06:00 user time, statement month = due-date month, nonexistent days
  fall on the last day of the month.
