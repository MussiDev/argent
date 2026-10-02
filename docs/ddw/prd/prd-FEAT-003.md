# PRD FEAT-003: Available balance vs net worth

| Field | Value |
|-------|-------|
| Ticket | FEAT-003 |
| Tracker | none |
| Date | 2026-10-02 |
| PRD loops | 1 |
| Loops since last human decision | 0 |

## Context and Problem
Amends the merged accounts feature (`prd-DISC-001-02a.md`, module `accounts`, web accounts
screens). Human feedback (2026-10-02): the account list headline today is one total per currency
equal to the sum of ALL active accounts (02a FR-10, AC-12). That sum includes savings and credit
cards, so the number a user sees first is not the money they can spend, which is confusing. Credit
cards also appear as plain accounts next to cash and bank accounts, which hides that they
represent debt. The human chose: each account gets an "include in available" setting with defaults
by type, the headline shows **Available** per currency with **Net worth** per currency smaller,
and credit cards move to their own section presented as debt. Credit cards remain accounts
internally; statements and installments arrive later with PRD 10.

## Goals
- Make the headline number answer "how much money can I spend now", per currency.
- Keep the all-accounts total available as a secondary figure (net worth), where card debt
  reduces it.
- Show credit cards as debt, apart from the accounts that hold money.
- Let the user decide, per account, whether a non-card account counts as available.

## Functional Requirements
- FR-01: The system must store, for every account, a boolean setting "include in available".
- FR-02: The system must return the setting in every account representation it returns.
- FR-03: The system must allow a user to set the setting when creating an account of type cash,
  bank account, digital wallet or savings; when the user omits it, the system must apply the
  default of the account's type: included for cash, bank account and digital wallet; not included
  for savings.
- FR-04: The system must allow a user to change the setting of an active account of type cash,
  bank account, digital wallet or savings after creation, without changing the account's name,
  type, currency or balance.
- FR-05: The system must keep the setting of every credit card account at "not included" and must
  reject any request that creates a credit card account as included or that changes the setting
  of a credit card account.
- FR-06: The system must reject a change of the setting on an archived account; the setting
  becomes editable again once the account is unarchived.
- FR-07: The system must show, per currency, the **Available** total: the sum of the balances of
  the active accounts of that currency whose setting is "included". Credit card debt is not
  subtracted from it.
- FR-08: The system must show, per currency, the **Net worth** total: the sum of the balances of
  all active accounts of that currency, credit cards included, as 02a FR-10 does today.
- FR-09: The system must show Available prominently and Net worth smaller in the account list
  headline.
- FR-10: The system must show credit card accounts in their own **Debt** section, separate from
  the section that lists the other accounts, with a total per currency equal to the sum of the
  balances of the active credit card accounts of that currency.
- FR-11: The system must give every account that existed before this change a value for the
  setting equal to the default of its type: included for cash, bank account and digital wallet;
  not included for savings and credit card.
- FR-12: The system must let a user change the setting only on accounts they own and must answer
  404 Not Found for accounts owned by another user (extends 02a FR-12).
- FR-13: The system must show the labels of this feature through the Spanish and English i18n
  catalogs: es "Disponible", "Patrimonio neto", "Deudas", "Incluir en disponible"; en
  "Available", "Net worth", "Debt", "Include in available".

## Non-Functional Requirements
- NFR-01: Available, Net worth and the Debt total must be computed without integer overflow for a
  user with up to 100,000 accounts each holding the maximum opening balance (10^15 minor units),
  so that 0 account list requests fail with a server error because of arithmetic (extends 02a
  NFR-06).
- NFR-02: Listing accounts with all totals must answer in < 300 ms at p95 for a user with up to
  100 accounts and 100,000 movements, measured server-side (keeps 02a NFR-02).
- NFR-03: The migration that adds the setting must be non-destructive, must leave 0 existing
  accounts without a value, and must have a documented rollback.
- NFR-04: 100% of queries that read or change the setting must be filtered by the account's owner
  (02a NFR-04).
- NFR-05: The new strings must appear in both catalogs, with 0 hardcoded user-visible strings in
  the new components.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user creates an account, THE system SHALL persist its "include in
  available" setting.
- AC-02 (FR-02): WHEN a user reads or lists accounts, THE system SHALL return the setting of each
  account.
- AC-03 (FR-03): WHEN a user creates a cash, bank account or digital wallet account without
  stating the setting, THE system SHALL set it to included.
- AC-04 (FR-03): WHEN a user creates a savings account without stating the setting, THE system
  SHALL set it to not included.
- AC-05 (FR-03): WHEN a user creates a cash, bank account, digital wallet or savings account
  stating the setting explicitly, THE system SHALL store the stated value instead of the default
  of its type.
- AC-06 (FR-03): IF a user submits a setting that is not a boolean, THEN THE system SHALL reject
  the request with a 400 validation error naming the setting field and SHALL NOT create the
  account.
- AC-07 (FR-04): WHEN a user changes the setting of an active cash, bank account, digital wallet
  or savings account, THE system SHALL persist it and leave name, type, currency and balance
  unchanged.
- AC-08 (FR-04): IF a user submits a change that carries a non-boolean setting, THEN THE system
  SHALL reject it with a 400 validation error naming the setting field and SHALL leave the
  account unchanged.
- AC-09 (FR-05): WHEN a user creates a credit card account without stating the setting, THE
  system SHALL store it as not included.
- AC-10 (FR-05): IF a user creates a credit card account stating the setting as included, THEN
  THE system SHALL reject the request with a 400 validation error naming the setting field and
  SHALL NOT create the account.
- AC-11 (FR-05): IF a user changes the setting of a credit card account, THEN THE system SHALL
  reject the request with a 400 validation error naming the setting field and SHALL leave the
  account unchanged.
- AC-12 (FR-06): IF a user changes the setting of an archived account, THEN THE system SHALL
  reject the request with a 409 conflict error and SHALL leave the account unchanged.
- AC-13 (FR-06): WHEN a user unarchives an account and then changes its setting, THE system SHALL
  persist the new value.
- AC-14 (FR-07): WHEN a user opens the account list, THE system SHALL show for each currency an
  Available total equal to the sum of the balances of the active accounts of that currency whose
  setting is included, and SHALL NOT subtract credit card balances from it.
- AC-15 (FR-07): WHILE no active account of a currency is included, THE system SHALL show an
  Available total of 0 for that currency.
- AC-16 (FR-08): WHEN a user opens the account list, THE system SHALL show for each currency a
  Net worth total equal to the sum of the balances of all active accounts of that currency,
  credit cards included.
- AC-17 (FR-07, FR-08, FR-10): WHEN the balances being added exceed the signed 64-bit maximum,
  THE system SHALL show the exact Available, Net worth and Debt totals instead of failing.
- AC-18 (FR-09): WHEN a user opens the account list, THE system SHALL render the Available total
  with a larger type size than the Net worth total.
- AC-19 (FR-10): WHEN a user has credit card accounts, THE system SHALL list them in the Debt
  section with a per-currency total, and SHALL NOT list them in the section of the other
  accounts.
- AC-20 (FR-10): WHILE a user has no active credit card account, THE system SHALL NOT show the
  Debt section.
- AC-21 (FR-11): WHEN the migration has run, THE system SHALL have set the setting of every
  pre-existing account to the default of its type: included for cash, bank account and digital
  wallet; not included for savings and credit card.
- AC-22 (FR-12): IF a user requests to change the setting of an account owned by another user,
  THEN THE system SHALL answer 404 Not Found and leave the account unchanged.
- AC-23 (FR-13): WHEN a user switches the interface between Spanish and English, THE system SHALL
  show "Disponible", "Patrimonio neto", "Deudas" and "Incluir en disponible" in Spanish and
  "Available", "Net worth", "Debt" and "Include in available" in English.

## Out of Scope
- Statements, closing and due dates, installments and payment of credit cards (PRD 10).
- Recording movements, transfers and exchange rates (PRD 03).
- Converting between ARS and USD, or a single combined total across currencies.
- Changing an account's type or currency (still immutable, 02a FR-04).
- Subtracting card debt from Available (decided against, see Decision Log).
- Reordering accounts manually.

## Risks and Mitigations
- **The account list is paginated (02a NFR-03) and the Debt section is a grouping of it** → PLAN
  decides how the API exposes the sections; all totals cover every active account, not just the
  page.
- **Backfilling changes the headline of existing users with savings accounts** → intended; the
  backfill is by type default, tested (AC-21) and the migration has a rollback (NFR-03).
- **Shared files with open branches (02b categories, 07a investments, 01f deletion)** → the
  conflicts are listed in the PLAN report; the migration number 0011 is reserved.

## Dependencies
- DISC-001-02a (Accounts) — the account model, list endpoint, totals and ownership rules this
  amends (FR-02, FR-04, FR-07, FR-08, FR-12).
- PRD 01 (Identity & Access) — user ownership and 404 policy (FR-12, NFR-04).
- PRD 10 (Credit Cards: Statements & Installments) — later behavior of the credit card account
  type (FR-05, FR-10).
- PRD 03 (Movements & Exchange Rates) — movements that make up balances (FR-07, FR-08).

## Decision Log
- 2026-10-02: Human decision (feedback on the account list): each account gets an "include in
  available" setting, changeable per account; defaults by type are included for cash, bank
  account and digital wallet and not included for savings (FR-01, FR-03, FR-04).
- 2026-10-02: Human decision: the account list headline shows Available per currency (sum of
  included accounts) prominently, and Net worth per currency (all active accounts, as today)
  smaller (FR-07, FR-08, FR-09). Supersedes 02a FR-10 and AC-12 as the headline; Net worth keeps
  their meaning.
- 2026-10-02: Human decision: credit cards are shown in their own section as debt, separate from
  the other accounts; they remain accounts internally and PRD 10 adds statements and installments
  later (FR-10).
- 2026-10-02: Human decision: credit card debt is NOT subtracted from Available; it reduces Net
  worth only. The Debt section shows the cards and its per-currency total (FR-07, FR-08, FR-10).
- 2026-10-02: Human decision: a credit card is NEVER included in Available and its setting is not
  editable (FR-05).
- 2026-10-02: Human decision: existing accounts are backfilled by type default; cash, bank
  account and digital wallet included, savings and credit card not included (FR-11).
- 2026-10-02: Human decision: archived accounts cannot change the setting; it is editable again
  after unarchive (FR-06).
- 2026-10-02: Human decision: labels es "Disponible", "Patrimonio neto", "Deudas", "Incluir en
  disponible"; en "Available", "Net worth", "Debt", "Include in available" (FR-13).
- 2026-10-02: Scope check: one ticket, two areas (accounts API and shared schemas, web accounts
  screens); 23 ACs, kept together because the setting, the totals and the card section are one
  user-visible change that cannot ship partially.
