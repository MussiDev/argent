# PRD FEAT-003: Available balance vs net worth

| Field | Value |
|-------|-------|
| Ticket | FEAT-003 |
| Tracker | none |
| Date | 2026-10-02 |
| PRD loops | 0 |
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

Points the human has NOT decided are listed in "Open Questions". Requirements that depend on them
are not written yet.

## Goals
- Make the headline number answer "how much money can I spend now", per currency.
- Keep the all-accounts total available as a secondary figure (net worth).
- Show credit cards as debt, apart from the accounts that hold money.
- Let the user decide, per account, whether it counts as available.

## Functional Requirements
- FR-01: The system must store, for every account, a boolean setting "include in available".
- FR-02: The system must return the setting in every account representation it returns.
- FR-03: The system must allow a user to set the setting when creating an account; when the user
  omits it, the system must apply the default of the account's type: included for cash, bank
  account and digital wallet; not included for savings. The default for credit card is pending
  OQ-1.
- FR-04: The system must allow a user to change the setting of an active account of type cash,
  bank account, digital wallet or savings after creation, without changing the account's name,
  type, currency or balance. Changing it for a credit card account is pending OQ-2, and changing
  it for an archived account is pending OQ-4.
- FR-05: The system must show, per currency, the **Available** total: the sum of the balances of
  the active accounts of that currency whose setting is "included".
- FR-06: The system must show, per currency, the **Net worth** total: the sum of the balances of
  all active accounts of that currency, as 02a FR-10 does today.
- FR-07: The system must show Available prominently and Net worth smaller in the account list
  headline.
- FR-08: The system must show credit card accounts in their own section, presented as debt,
  separate from the section that lists the other accounts.
- FR-09: The system must give every account that existed before this change a value for the
  setting, so that no account is left without one. The backfill rule is pending OQ-3.
- FR-10: The system must let a user change the setting only on accounts they own and must answer
  404 Not Found for accounts owned by another user (extends 02a FR-12).
- FR-11: The system must send every new user-visible label of this feature through the Spanish and
  English i18n catalogs. The wording of the labels is pending OQ-5.

## Non-Functional Requirements
- NFR-01: Available and Net worth must be computed without integer overflow for a user with up to
  100,000 accounts each holding the maximum opening balance (10^15 minor units), so that 0 account
  list requests fail with a server error because of arithmetic (extends 02a NFR-06).
- NFR-02: Listing accounts with both totals must answer in < 300 ms at p95 for a user with up to
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
- AC-05 (FR-03): WHEN a user creates an account stating the setting explicitly, THE system SHALL
  store the stated value instead of the default of its type.
- AC-06 (FR-03): IF a user submits a setting that is not a boolean, THEN THE system SHALL reject
  the request with a 400 validation error naming the setting field and SHALL NOT create the
  account.
- AC-07 (FR-04): WHEN a user changes the setting of an active cash, bank account, digital wallet
  or savings account, THE system SHALL persist it and leave name, type, currency and balance
  unchanged.
- AC-08 (FR-04): IF a user submits a change that carries a non-boolean setting, THEN THE system
  SHALL reject it with a 400 validation error naming the setting field and SHALL leave the
  account unchanged.
- AC-09 (FR-05): WHEN a user opens the account list, THE system SHALL show for each currency an
  Available total equal to the sum of the balances of the active accounts of that currency whose
  setting is included.
- AC-10 (FR-05): WHILE no active account of a currency is included, THE system SHALL show an
  Available total of 0 for that currency.
- AC-11 (FR-06): WHEN a user opens the account list, THE system SHALL show for each currency a
  Net worth total equal to the sum of the balances of all active accounts of that currency.
- AC-12 (FR-05, FR-06): WHEN the balances being added exceed the signed 64-bit maximum, THE system
  SHALL show the exact Available and Net worth totals instead of failing.
- AC-13 (FR-07): WHEN a user opens the account list, THE system SHALL render the Available total
  with a larger type size than the Net worth total.
- AC-14 (FR-08): WHEN a user has credit card accounts, THE system SHALL list them in a section
  separate from the other accounts and SHALL NOT list them in the section of the other accounts.
- AC-15 (FR-09): WHEN the migration has run, THE system SHALL have a value for the setting on 100%
  of the accounts that existed before it.
- AC-16 (FR-10): IF a user requests to change the setting of an account owned by another user,
  THEN THE system SHALL answer 404 Not Found and leave the account unchanged.
- AC-17 (FR-11): WHEN a user switches the interface between Spanish and English, THE system SHALL
  show every label of this feature in the chosen language.

## Out of Scope
- Statements, closing and due dates, installments and payment of credit cards (PRD 10).
- Recording movements, transfers and exchange rates (PRD 03).
- Converting between ARS and USD, or a single combined total across currencies.
- Changing an account's type or currency (still immutable, 02a FR-04).
- A total for the debt section, until OQ-1 is answered.
- Reordering accounts manually.

## Risks and Mitigations
- **The account list is paginated (02a NFR-03) and the credit card section is a grouping of it** →
  PLAN decides whether the API returns the sections separately or the client groups the page; the
  totals already cover all active accounts, not just the page.
- **Backfilling the wrong default silently changes the headline of existing users** → the
  backfill is a decision (OQ-3), tested, and the migration has a rollback (NFR-03).
- **Debt counted twice or not at all in the headline** → whether the card is subtracted from
  Available is a decision (OQ-1) recorded before the spec.
- **Shared files with open branches (02b categories, 07a investments, 01f deletion)** → the
  conflicts are listed in the PLAN report; the migration number is reserved (0011).

## Dependencies
- DISC-001-02a (Accounts) — the account model, list endpoint, totals and ownership rules this
  amends (FR-02, FR-04, FR-05, FR-06, FR-10).
- PRD 01 (Identity & Access) — user ownership and 404 policy (FR-10, NFR-04).
- PRD 10 (Credit Cards: Statements & Installments) — later behavior of the credit card account
  type (FR-08).
- PRD 03 (Movements & Exchange Rates) — movements that make up balances (FR-05, FR-06).

## Open Questions
Each needs a human answer before the PRD is approved and the spec is written. None is assumed.

- OQ-1: Is credit card debt subtracted from Available, or only from Net worth?
  Recommendation: subtract it only from Net worth; Available stays money you can spend now, and
  the debt section shows what is owed. Tradeoff: a user who pays the card from the same ARS money
  sees an Available that does not reflect the coming payment; subtracting it is more conservative
  but mixes debt into the "cash in hand" number. Depends on this: the default of the setting for
  credit cards (not included under the recommendation) and whether the debt section shows a
  total.
- OQ-2: Is the "include in available" setting of a credit card editable at all?
  Recommendation: not editable; a card is never included, because it holds no spendable money and
  the setting would only let the user mix debt into Available by accident. Tradeoff: less
  flexibility for users who want it (answering OQ-1 with "subtract" makes the setting a fixed
  true instead).
- OQ-3: How are existing accounts backfilled?
  Recommendation: by type default (cash, bank account, digital wallet included; savings not
  included; credit card per OQ-1/OQ-2). Tradeoff: existing users with savings accounts see their
  Available drop on the first load, which is the intent of the change but can surprise them;
  backfilling everything as included would keep the old number but defeat the feature.
- OQ-4: Can archived accounts change the setting?
  Recommendation: no, only active accounts; archived accounts are excluded from both totals
  anyway, and the setting is editable again after unarchive. Tradeoff: one extra rule to explain
  versus a harmless but invisible edit.
- OQ-5: What are the exact labels (Spanish and English) for Available, Net worth, the debt
  section and the setting?
  Recommendation: Spanish "Disponible", "Patrimonio neto", "Deudas" / "Tarjetas de crédito",
  "Incluir en disponible"; English "Available", "Net worth", "Debt" / "Credit cards", "Include in
  available". Tradeoff: "Deudas" frames cards purely as debt, "Tarjetas de crédito" is the
  familiar name; the human chose "debt" as the framing, so "Deudas" is closer to the decision.

## Decision Log
- 2026-10-02: Human decision (feedback on the account list): each account gets an "include in
  available" setting, changeable per account; defaults by type are included for cash, bank
  account and digital wallet and not included for savings (FR-01, FR-03, FR-04).
- 2026-10-02: Human decision: the account list headline shows Available per currency (sum of
  included accounts) prominently, and Net worth per currency (all active accounts, as today)
  smaller (FR-05, FR-06, FR-07). Supersedes 02a FR-10 and AC-12 as the headline; Net worth keeps
  their meaning.
- 2026-10-02: Human decision: credit cards are shown in their own section as debt, separate from
  the other accounts; they remain accounts internally and PRD 10 adds statements and installments
  later (FR-08).
- 2026-10-02: Scope check: one ticket, two areas (accounts API and shared schemas, web accounts
  screens); 17 ACs, kept together because the setting, the totals and the card section are one
  user-visible change that cannot ship partially.
