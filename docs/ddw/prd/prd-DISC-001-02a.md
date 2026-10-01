# PRD DISC-001-02a: Accounts

| Field | Value |
|-------|-------|
| Ticket | DISC-001-02a |
| Tracker | none |
| Date | 2026-10-01 |
| PRD loops | 3 |
| Loops since last human decision | 0 |

## Context and Problem
First sub-ticket of Accounts & Categories (parent index: `prd-DISC-001-02.md`). Every movement in
the finance PWA (see `docs/ddw/discovery/concept-DISC-001.md`) happens in an account (where the
money is). Users in Argentina hold money in several places at once — cash, bank accounts in ARS and
in USD, digital wallets, credit cards — and need to see each balance separately. Without accounts
there is nothing to record movements against. Split from `prd-DISC-001-02.md` (2026-10-01, user
decision). Requirement IDs were renumbered; the parent index maps every original ID to its new one.

## Goals
- Let each user model where their money is, one account per place and currency.
- Keep the history intact: nothing that has movements can disappear.

## Functional Requirements
- FR-01: The system must allow a user to create an account with a name, a type, a currency and
  an optional opening balance; the system must store 0 when it is omitted and must accept
  negative values.
- FR-02: The system must offer exactly these account types: cash, bank account, digital wallet,
  credit card and savings.
- FR-03: The system must assign each account exactly one currency, ARS or USD, chosen at
  creation.
- FR-04: The system must not allow a user to change the currency or the type of an account after
  it has been created.
- FR-05: The system must allow a user to rename an account.
- FR-06: The system must allow a user to archive an account.
- FR-07: The system must allow a user to unarchive an archived account.
- FR-08: The system must allow a user to delete an account only when it has no movements.
- FR-09: The system must list the user's active accounts with each account's current balance in
  its own currency.
- FR-10: The system must show, next to the account list, the total balance per currency (one
  total for ARS accounts, one for USD accounts).
- FR-11: The system must reject an account name that already exists among that user's accounts
  (case-insensitive).
- FR-12: The system must let a user read, edit, archive and delete only the accounts they own.
- FR-13: The system must reject an opening balance whose absolute value is greater than 10^13
  major units (10^15 minor units) with a validation error that names the opening balance field.
- FR-14: The system must reject an account name that contains a Unicode control or format
  character (categories Cc and Cf, including zero-width and bidirectional override characters)
  with a validation error that names the name field.

## Non-Functional Requirements
- NFR-01: Amounts (opening balance, balances, totals) must be stored as 64-bit integers in minor
  units (1 unit = 0.01 ARS or 0.01 USD), with 0 floating-point columns or fields for money, so
  that summing 100,000 movements produces a difference of exactly 0 against the expected total
  (concept decision: design for scalability and correctness).
- NFR-02: Listing accounts with balances must answer in < 300 ms at p95 for a user with up to 100
  accounts and 100,000 movements, measured server-side.
- NFR-03: The account list endpoint must be paginated with a maximum page size of 100 items.
- NFR-04: Every account must belong to exactly one user, and 100% of queries on accounts must be
  filtered by the owner (PRD 01, FR-23).
- NFR-05: Account names must be between 1 and 50 characters.
- NFR-06: Balances and totals must be computed and returned without integer overflow for a user
  with up to 100,000 accounts each holding the maximum opening balance (a total of 10^20 minor
  units, above the signed 64-bit limit), so that 0 account list requests fail with a server error
  because of arithmetic.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user submits a new account with a valid name, type, currency and opening
  balance, THE system SHALL create it and show it in the account list with that balance.
- AC-02 (FR-01): IF a user submits a new account with a missing name, type or currency, THEN THE
  system SHALL reject it and name the missing field.
- AC-03 (FR-02): WHEN a user opens the account creation form, THE system SHALL offer exactly the
  types cash, bank account, digital wallet, credit card and savings.
- AC-04 (FR-03): IF a user submits a new account with a currency other than ARS or USD, THEN THE
  system SHALL reject it.
- AC-05 (FR-04): IF a user submits a change to the currency or the type of an existing account,
  THEN THE system SHALL reject it and leave the account unchanged.
- AC-06 (FR-05): WHEN a user saves a new valid name for an account, THE system SHALL persist it
  and show it everywhere the account appears.
- AC-07 (FR-06): WHEN a user archives an account, THE system SHALL hide it from the active
  account list and from account pickers, and SHALL keep its movements visible in history.
- AC-08 (FR-07): WHEN a user unarchives an account, THE system SHALL show it again in the active
  account list and in account pickers.
- AC-09 (FR-08): WHEN a user deletes an account that has no movements, THE system SHALL remove
  it.
- AC-10 (FR-08): IF a user tries to delete an account that has at least one movement, THEN THE
  system SHALL reject the deletion and offer to archive it instead.
- AC-11 (FR-09): WHEN a user opens the account list, THE system SHALL show every active account
  with its balance in its own currency, equal to the opening balance plus the sum of its
  movements.
- AC-12 (FR-10): WHEN a user opens the account list, THE system SHALL show one total for ARS
  accounts and one total for USD accounts, each equal to the sum of the balances of the active
  accounts in that currency.
- AC-13 (FR-11): IF a user creates or renames an account with a name that already exists among
  their accounts (case-insensitive), THEN THE system SHALL reject it.
- AC-14 (FR-12): IF a user requests to read, edit, archive or delete an account owned by another
  user, THEN THE system SHALL answer 404 Not Found and leave it unchanged.
- AC-15 (FR-12): WHEN a user opens the account list or an account picker, THE system SHALL show
  only accounts owned by that user.
- AC-16 (FR-01): WHEN a user submits a new account with a valid name, type and currency and no
  opening balance, THE system SHALL create it with an opening balance of 0.
- AC-17 (FR-01): WHEN a user submits a new account with a negative opening balance, THE system
  SHALL create it and show that negative balance in the account list.
- AC-18 (FR-13): IF a user submits a new account with an opening balance above 10^15 minor units
  or below -10^15 minor units, THEN THE system SHALL reject it with a 400 validation error naming
  the opening balance field and SHALL NOT create the account.
- AC-19 (FR-13): WHEN a user submits a new account with an opening balance of exactly 10^15 minor
  units or exactly -10^15 minor units, THE system SHALL create it.
- AC-20 (FR-14): IF a user creates or renames an account with a name that contains a control or
  format character, THEN THE system SHALL reject it with a 400 validation error naming the name
  field and SHALL leave the account unchanged.
- AC-21 (FR-14): IF a user creates or renames an account with a name made only of whitespace,
  control or format characters, THEN THE system SHALL reject it as an empty name.
- AC-22 (FR-10): WHEN the active accounts of one currency add up to more than the signed 64-bit
  maximum, THE system SHALL show the exact total in the account list instead of failing.

## Out of Scope
- Statement cycles, closing and due dates, and installment purchases on credit cards (PRD 10).
- Recording movements, transfers and exchange rates (PRD 03).
- Currencies other than ARS and USD.
- Accounts shared between users (joint accounts); groups split expenses instead (PRD 05).
- Categories, their defaults and their management (DISC-001-02b).
- Reordering accounts manually.
- Bank account synchronization or statement import.

## Risks and Mitigations
- **Deleting data that history depends on** → deletion only when unused (FR-08); archive
  otherwise (FR-06).
- **Balance computed on every read gets slow as movements grow** → NFR-02 sets the budget; PLAN
  decides between computing on read and keeping a running balance.
- **Changing an account's currency would silently corrupt its history** → currency is immutable
  (FR-04).

## Dependencies
- PRD 01 (Identity & Access) — user ownership and access control (NFR-04, FR-12).
- PRD 03 (Movements & Exchange Rates) — movements that make up balances (FR-08, FR-09).
- PRD 10 (Credit Cards: Statements & Installments) — behavior of the credit card account type
  (FR-02).
- PRD 05 (Groups & Expense Splitting) — groups split expenses instead of joint accounts (Out of
  Scope).

## Decision Log
- 2026-09-25: Credit cards modeled with statements and installments in PRD 10; this PRD only
  declares the credit card account type.
- 2026-09-25: User approved the parent PRD after the loop ceiling, including: account types
  (cash, bank account, digital wallet, credit card, savings), one currency per account,
  immutable currency and type, archive instead of delete when data exists, no joint accounts.
- 2026-10-01: Parent PRD split into DISC-001-02a (accounts) and DISC-001-02b (categories) by user
  decision.
- 2026-10-01: Human decision during PLAN: the opening balance may be negative (any signed 64-bit
  value, including zero), and it is optional: when omitted the API stores 0 (FR-01, AC-16, AC-17).
- 2026-10-01: Human decision after VERIFY (L-1): the opening balance is bounded to an absolute
  value of 10^13 major units (10^15 minor units); a value outside the bound is a validation error,
  never a server error, and balances and totals cannot overflow (FR-13, NFR-06, AC-18, AC-19,
  AC-22).
- 2026-10-01: Human decision after VERIFY (I-2): account names reject Unicode control and format
  characters (Cc and Cf, including zero-width and bidirectional override characters); a name that
  is empty once those are ignored is an empty name (FR-14, AC-20, AC-21).
- 2026-10-01: Human decision during PLAN: there is no cap on the number of accounts per user and
  no extra write-rate limit; do not re-raise it in reviews.
