# PRD DISC-001-02b: Categories

| Field | Value |
|-------|-------|
| Ticket | DISC-001-02b |
| Tracker | none |
| Date | 2026-10-01 |
| PRD loops | 1 |
| Loops since last human decision | 0 |

## Context and Problem
Second sub-ticket of Accounts & Categories (parent index: `prd-DISC-001-02.md`). Every movement in
the finance PWA (see `docs/ddw/discovery/concept-DISC-001.md`) belongs to a category (what the
money was for). Without categories there is nothing to report on. Users need a useful set of
categories from day one, which they can adapt to their life. Split from `prd-DISC-001-02.md`
(2026-10-01, user decision). Requirement IDs were renumbered; the parent index maps every original
ID to its new one.

## Goals
- Give every user a useful set of categories from day one, which they can adapt to their life.
- Keep the history intact: nothing that has movements can disappear.

## Functional Requirements
- FR-01: The system must create the default category set (see Appendix A) for every new user.
- FR-02: The system must allow a user to create a category with a name, a kind (expense or
  income), an icon, a color and an optional parent category.
- FR-03: The system must allow a category to have a parent only if that parent has no parent
  itself (one level of subcategories at most).
- FR-04: The system must allow a category to have a parent only if the parent is of the same
  kind (expense or income).
- FR-05: The system must allow a user to edit a category's name, icon and color.
- FR-06: The system must allow a user to archive a category.
- FR-07: The system must allow a user to unarchive an archived category.
- FR-08: The system must allow a user to delete a category only when no movement uses it and it
  has no subcategories.
- FR-09: The system must reject a category name that already exists among the categories with
  the same parent and kind for that user (case-insensitive).
- FR-10: The system must let a user read, edit, archive and delete only the categories they own.
- FR-11: The system must show each default category that the user has not renamed in the user's
  current interface language (PRD 01, FR-26), using the Spanish names of Appendix A for Spanish and
  the English names for English, and must keep showing it in the new language when the user changes
  the interface language.
- FR-12: The system must treat a default category as the user's own once the user renames it: the
  new name is kept whatever the interface language and the category is no longer translated.

## Non-Functional Requirements
- NFR-01: The category list endpoint must be paginated with a maximum page size of 100 items.
- NFR-02: Every category must belong to exactly one user, and 100% of queries on categories must
  be filtered by the owner (PRD 01, FR-23).
- NFR-03: Category names must be between 1 and 50 characters.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a new user account is created, THE system SHALL create for that user
  exactly the categories and subcategories listed in Appendix A.
- AC-02 (FR-02): WHEN a user submits a new category with a valid name, kind, icon and color, THE
  system SHALL create it and offer it when recording a movement of that kind.
- AC-03 (FR-03): IF a user sets as parent a category that already has a parent, THEN THE system
  SHALL reject it with the message "Subcategories cannot have subcategories".
- AC-04 (FR-04): IF a user sets as parent a category of a different kind, THEN THE system SHALL
  reject it.
- AC-05 (FR-05): WHEN a user saves a new name, icon or color for a category, THE system SHALL
  persist it and show it in every existing movement of that category.
- AC-06 (FR-06): WHEN a user archives a category, THE system SHALL hide it from category pickers
  and SHALL keep it on existing movements.
- AC-07 (FR-06): WHEN a user archives a category that has subcategories, THE system SHALL
  archive its subcategories too.
- AC-08 (FR-07): WHEN a user unarchives a category, THE system SHALL offer it again in category
  pickers.
- AC-09 (FR-08): WHEN a user deletes a category with no movements and no subcategories, THE
  system SHALL remove it.
- AC-10 (FR-08): IF a user tries to delete a category that is used by a movement or has
  subcategories, THEN THE system SHALL reject the deletion and offer to archive it instead.
- AC-11 (FR-09): IF a user creates or renames a category with a name that already exists under
  the same parent and kind (case-insensitive), THEN THE system SHALL reject it.
- AC-12 (FR-10): IF a user requests to read, edit, archive or delete a category owned by another
  user, THEN THE system SHALL answer 404 Not Found and leave it unchanged.
- AC-13 (FR-10): WHEN a user opens a category picker, THE system SHALL show only categories
  owned by that user.
- AC-14 (FR-11): WHEN a user whose interface language is Spanish lists their categories, THE
  system SHALL show the default categories with their Spanish names (for example "Comida" and
  "Supermercado").
- AC-15 (FR-11): WHEN a user changes the interface language from Spanish to English, THE system
  SHALL show every default category that the user has not renamed with its English name (for
  example "Food" and "Groceries").
- AC-16 (FR-12): WHEN a user renames a default category and then changes the interface language,
  THE system SHALL keep showing the name the user chose.
- AC-17 (FR-12): WHILE a default category has not been renamed by the user, THE system SHALL keep
  translating it when the interface language changes.

## Out of Scope
- Recording movements (PRD 03).
- Accounts and their management (DISC-001-02a).
- Categories shared between users or defined per group (PRD 05 decides group categories).
- More than one level of subcategories.
- Reordering categories manually.
- Automatic categorization of movements.

## Risks and Mitigations
- **Too many categories slow down expense entry** → one level of subcategories only (FR-03), and
  a compact default set (Appendix A) the user can archive.
- **Deleting data that history depends on** → deletion only when unused (FR-08); archive
  otherwise (FR-06).

## Dependencies
- PRD 01 (Identity & Access) — user ownership and access control (NFR-02, FR-01, FR-10), and the
  user's interface language preference (FR-11, FR-12), delivered by DISC-001-01d.
- PRD 03 (Movements & Exchange Rates) — movements that use categories (FR-08).
- PRD 05 (Groups & Expense Splitting) — categories used in groups (Out of Scope).

## Decision Log
- 2026-09-25: Categories predefined and editable, one level of subcategories.
- 2026-09-25: User decision: the interface is bilingual, Spanish and English.
- 2026-09-25: User approved the parent PRD after the loop ceiling, including default categories
  in Appendix A.
- 2026-10-01: Human decision (Q4): categories get their own module, `apps/api/src/categories/`,
  and a matching web feature; `categories` joins the module list of AGENTS.md in this ticket.
- 2026-10-01: Human decision (Q3): default categories follow the user's CURRENT interface language
  and are shown translated when the language changes; once the user renames a default category it
  becomes the user's own and is no longer translated, while untouched defaults keep translating.
  This replaces the earlier wording "in the language at the moment the user is created" (FR-11,
  FR-12, AC-14 to AC-17).
- 2026-10-01: Parent PRD split into DISC-001-02a (accounts) and DISC-001-02b (categories) by user
  decision.

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

Income:
- Salary
- Freelance
- Investment returns
- Gifts received
- Other income

Spanish names (FR-11, shown while the interface language is Spanish): Comida — Supermercado, Restaurantes, Delivery · Transporte — Nafta,
Transporte público, Apps de viaje, Estacionamiento · Hogar — Alquiler, Servicios, Mantenimiento ·
Salud — Prepaga, Farmacia, Médico · Entretenimiento — Salidas, Streaming, Hobbies · Compras —
Ropa, Electrónica, Regalos · Educación · Impuestos y comisiones · Otros gastos · Sueldo · Freelance
· Rendimientos de inversiones · Regalos recibidos · Otros ingresos.
