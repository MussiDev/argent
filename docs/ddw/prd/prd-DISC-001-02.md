# PRD DISC-001-02: Accounts & Categories

| Field | Value |
|-------|-------|
| Ticket | DISC-001 |
| Tracker | none |
| Date | 2026-09-25 |
| PRD loops | 5 |
| Loops since last human decision | 0 |

## Context and Problem
Every movement in the finance PWA (see `docs/ddw/discovery/concept-DISC-001.md`) happens in an
account (where the money is) and belongs to a category (what the money was for). Users in
Argentina hold money in several places at once — cash, bank accounts in ARS and in USD, digital
wallets, credit cards — and need to see each balance separately. Without accounts and categories
there is nothing to record movements against and nothing to report on.

## Goals
- Let each user model where their money is, one account per place and currency.
- Give every user a useful set of categories from day one, which they can adapt to their life.
- Keep the history intact: nothing that has movements can disappear.

## Functional Requirements
- FR-01: The system must allow a user to create an account with a name, a type, a currency and
  an opening balance.
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
- FR-11: The system must create the default category set (see Appendix A) for every new user.
- FR-12: The system must allow a user to create a category with a name, a kind (expense or
  income), an icon, a color and an optional parent category.
- FR-13: The system must allow a category to have a parent only if that parent has no parent
  itself (one level of subcategories at most).
- FR-20: The system must allow a category to have a parent only if the parent is of the same
  kind (expense or income).
- FR-14: The system must allow a user to edit a category's name, icon and color.
- FR-15: The system must allow a user to archive a category.
- FR-16: The system must allow a user to unarchive an archived category.
- FR-17: The system must allow a user to delete a category only when no movement uses it and it
  has no subcategories.
- FR-18: The system must reject a category name that already exists among the categories with
  the same parent and kind for that user (case-insensitive).
- FR-19: The system must reject an account name that already exists among that user's accounts
  (case-insensitive).
- FR-21: The system must let a user read, edit, archive and delete only the accounts and
  categories they own.
- FR-22: The system must create the default categories in the user's interface language (PRD 01,
  FR-26) at the moment the user is created, using the Spanish names of Appendix A for Spanish.

## Non-Functional Requirements
- NFR-01: Amounts (opening balance, balances, totals) must be stored as 64-bit integers in minor
  units (1 unit = 0.01 ARS or 0.01 USD), with 0 floating-point columns or fields for money, so
  that summing 100,000 movements produces a difference of exactly 0 against the expected total
  (concept decision: design for scalability and correctness).
- NFR-02: Listing accounts with balances must answer in < 300 ms at p95 for a user with up to 100
  accounts and 100,000 movements, measured server-side.
- NFR-03: Every list endpoint (accounts, categories) must be paginated with a maximum page size
  of 100 items.
- NFR-04: Every account and category must belong to exactly one user, and 100% of queries on them
  must be filtered by the owner (PRD 01, FR-23).
- NFR-05: Account and category names must be between 1 and 50 characters.

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
- AC-13 (FR-11): WHEN a new user account is created, THE system SHALL create for that user
  exactly the categories and subcategories listed in Appendix A.
- AC-14 (FR-12): WHEN a user submits a new category with a valid name, kind, icon and color, THE
  system SHALL create it and offer it when recording a movement of that kind.
- AC-15 (FR-13): IF a user sets as parent a category that already has a parent, THEN THE system
  SHALL reject it with the message "Subcategories cannot have subcategories".
- AC-16 (FR-20): IF a user sets as parent a category of a different kind, THEN THE system SHALL
  reject it.
- AC-17 (FR-14): WHEN a user saves a new name, icon or color for a category, THE system SHALL
  persist it and show it in every existing movement of that category.
- AC-18 (FR-15): WHEN a user archives a category, THE system SHALL hide it from category pickers
  and SHALL keep it on existing movements.
- AC-19 (FR-15): WHEN a user archives a category that has subcategories, THE system SHALL
  archive its subcategories too.
- AC-20 (FR-16): WHEN a user unarchives a category, THE system SHALL offer it again in category
  pickers.
- AC-21 (FR-17): WHEN a user deletes a category with no movements and no subcategories, THE
  system SHALL remove it.
- AC-22 (FR-17): IF a user tries to delete a category that is used by a movement or has
  subcategories, THEN THE system SHALL reject the deletion and offer to archive it instead.
- AC-23 (FR-18): IF a user creates or renames a category with a name that already exists under
  the same parent and kind (case-insensitive), THEN THE system SHALL reject it.
- AC-24 (FR-19): IF a user creates or renames an account with a name that already exists among
  their accounts (case-insensitive), THEN THE system SHALL reject it.
- AC-25 (FR-21): IF a user requests to read, edit, archive or delete an account or category
  owned by another user, THEN THE system SHALL answer 404 Not Found and leave it unchanged.
- AC-26 (FR-21): WHEN a user opens the account list or a category picker, THE system SHALL show
  only accounts and categories owned by that user.
- AC-27 (FR-22): WHEN a user whose interface language is Spanish is created, THE system SHALL
  create the default categories with their Spanish names (for example "Comida" and
  "Supermercado").

## Out of Scope
- Statement cycles, closing and due dates, and installment purchases on credit cards (PRD 10).
- Recording movements, transfers and exchange rates (PRD 03).
- Currencies other than ARS and USD.
- Accounts shared between users (joint accounts); groups split expenses instead (PRD 05).
- Categories shared between users or defined per group (PRD 05 decides group categories).
- More than one level of subcategories.
- Reordering accounts or categories manually.
- Automatic categorization of movements.
- Bank account synchronization or statement import.

## Risks and Mitigations
- **Too many categories slow down expense entry** → one level of subcategories only (FR-13), and
  a compact default set (Appendix A) the user can archive.
- **Deleting data that history depends on** → deletion only when unused (FR-08, FR-17); archive
  otherwise (FR-06, FR-15).
- **Balance computed on every read gets slow as movements grow** → NFR-02 sets the budget; PLAN
  decides between computing on read and keeping a running balance.
- **Changing an account's currency would silently corrupt its history** → currency is immutable
  (FR-04).

## Dependencies
- PRD 01 (Identity & Access) — user ownership and access control (NFR-04, FR-11, FR-21).
- PRD 03 (Movements & Exchange Rates) — movements that make up balances and use categories
  (FR-08, FR-09, FR-17).
- PRD 10 (Credit Cards: Statements & Installments) — behavior of the credit card account type
  (FR-02).
- PRD 05 (Groups & Expense Splitting) — categories used in groups (Out of Scope).

## Decision Log
- 2026-09-25: Credit cards modeled with statements and installments in PRD 10; this PRD only
  declares the credit card account type.
- 2026-09-25: Categories predefined and editable, one level of subcategories.
- 2026-09-25: User approved this PRD after the loop ceiling, including: account types (cash,
  bank account, digital wallet, credit card, savings), one currency per account, immutable
  currency and type, archive instead of delete when data exists, default categories in
  Appendix A, no joint accounts.

## Appendix A: Default categories

Expense:
- Food — Groceries, Restaurants, Delivery
- Transport — Fuel, Public transport, Ride-hailing, Parking
- Home — Rent, Utilities, Maintenance
- Health — Health insurance, Pharmacy, Doctor
- Entertainment — Outings, Streaming, Hobbies
- Shopping — Clothing, Electronics, Gifts
- Education
- Taxes & fees
- Other expenses

Spanish names (FR-22): Comida — Supermercado, Restaurantes, Delivery · Transporte — Nafta,
Transporte público, Apps de viaje, Estacionamiento · Hogar — Alquiler, Servicios, Mantenimiento ·
Salud — Prepaga, Farmacia, Médico · Entretenimiento — Salidas, Streaming, Hobbies · Compras —
Ropa, Electrónica, Regalos · Educación · Impuestos y comisiones · Otros gastos · Sueldo · Freelance
· Rendimientos de inversiones · Regalos recibidos · Otros ingresos.

Income:
- Salary
- Freelance
- Investment returns
- Gifts received
- Other income
- 2026-09-25: User decision: the interface is bilingual, Spanish and English.
