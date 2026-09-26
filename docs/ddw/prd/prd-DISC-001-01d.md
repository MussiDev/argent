# PRD DISC-001-01d: Profile, Preferences & Account Deletion

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01d |
| Tracker | none |
| Date | 2026-09-26 |
| PRD loops | 1 |
| Loops since last human decision | 0 |

## Context and Problem
Fourth sub-ticket of Identity & Access (parent index: `prd-DISC-001-01.md`). DISC-001-01a stores
defaults for every account (rate type, display currency, time zone, language); users need to see
their profile and change those preferences, because almost every later module reads them. Users
also have the right to delete their account and personal data. Split from `prd-DISC-001-01.md` (2026-09-26, user decision). Requirement IDs were renumbered; the parent index maps every original ID to its new one.

## Goals
- A profile screen with display name, email and 2FA status.
- Editable preferences: default rate type, display currency, time zone and interface language.
- Permanent account deletion after re-authentication.

## Functional Requirements
- FR-01: The system must allow a user to view their profile: display name, email and 2FA status.
- FR-02: The system must allow a user to edit their display name.
- FR-03: The system must not allow a user to change the email of their account.
- FR-04: The system must allow a user to set their default exchange rate type (one of oficial,
  blue, bolsa/MEP, contado con liquidación, mayorista, cripto, tarjeta).
- FR-05: The system must allow a user to set their display currency (ARS or USD).
- FR-06: The system must allow a user to set their time zone, chosen from the IANA time zone
  database (for example `America/Argentina/Buenos_Aires`).
- FR-07: The system must allow a user to set their interface language: Spanish or English.
- FR-08: The system must allow a user to permanently delete their account and all their personal
  data, after re-authenticating.

## Non-Functional Requirements
- NFR-01: Saving the profile or a preference must answer in < 300 ms at p95, measured
  server-side.
- NFR-02: After an account deletion, 0 rows of the data listed in AC-10 must remain for that user,
  verified by an automated test.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user opens their profile, THE system SHALL show their display name,
  email and whether 2FA is enabled.
- AC-02 (FR-02): WHEN a user saves a display name between 1 and 50 characters, THE system SHALL
  persist it and show it in the profile.
- AC-03 (FR-02): IF a user saves an empty display name or one longer than 50 characters, THEN
  THE system SHALL reject it and keep the previous name.
- AC-04 (FR-03): IF a profile update request includes an email different from the account's
  email, THEN THE system SHALL reject it with 400 Bad Request and leave the email unchanged.
- AC-05 (FR-04): WHEN a user saves a default exchange rate type, THE system SHALL persist it and
  show the saved value in the preferences screen after the user signs out and signs in again.
- AC-06 (FR-05): WHEN a user saves a display currency, THE system SHALL persist it and show the
  saved value in the preferences screen after the user signs out and signs in again.
- AC-07 (FR-06): WHEN a user saves the time zone `Europe/Madrid`, THE system SHALL persist it and
  show it in the preferences screen.
- AC-08 (FR-06): IF a user submits a time zone that is not in the IANA time zone database, THEN
  THE system SHALL reject it and keep the previous one.
- AC-09 (FR-07): WHEN a user switches the interface language to English, THE system SHALL show
  every screen in English and format amounts as 1,557.30.
- AC-10 (FR-08): WHEN a user confirms account deletion after re-authenticating, THE system SHALL
  delete their personal data — profile, credentials, linked Google identity, 2FA secrets and
  recovery codes, preferences, sessions, and every financial record they own that is not shared
  with a group — and end all their sessions.
- AC-11 (FR-08): IF the re-authentication before account deletion fails, THEN THE system SHALL
  not delete the account and SHALL count it as a failed sign-in attempt.

## Out of Scope
- Changing the account email.
- Theme selection (PRD 09 covers it).
- Data export before deletion.
- What happens to group-shared movements of a deleted user (PRD 05).
- Undoing an account deletion.

## Risks and Mitigations
- **Accidental deletion** → re-authentication before deletion (AC-11).
- **Personal data left behind** → explicit list of deleted data (AC-10) and a zero-rows test
  (NFR-02).
- **Other modules read stale preferences** → preferences are read from the user record on every
  request, never cached in process memory (AGENTS.md: stateless API).

## Dependencies
- DISC-001-01a (Email & Password Authentication) — accounts, sessions, stored defaults.
- DISC-001-01c (Two-Factor Authentication) — 2FA status shown in the profile (FR-01).
- Exchange rate types catalog, defined in PRD 03 (Movements & Exchange Rates) — FR-04.
- IANA time zone database — FR-06.
- PRD 05 (Groups & Expense Splitting) — group records of deleted users.

## Decision Log
- 2026-09-26: Split from DISC-001-01 (user decision).
- 2026-09-26: NFR-01 and NFR-02 made explicit when splitting; confirmed by the user.
- 2026-09-26: User approved this sub-PRD and the non-functional requirements added when splitting.
