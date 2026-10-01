# PRD DISC-001-01d: Profile & Preferences

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01d |
| Tracker | none |
| Date | 2026-10-01 |
| PRD loops | 2 |
| Loops since last human decision | 0 |

## Context and Problem
Fourth sub-ticket of Identity & Access (parent index: `prd-DISC-001-01.md`). DISC-001-01a stores
defaults for every account (rate type, display currency, time zone, language); users need to see
their profile and change those preferences, because almost every later module reads them. Split
from `prd-DISC-001-01.md` (2026-09-26, user decision); on 2026-10-01 the user split this ticket
again, so account deletion moved to `prd-DISC-001-01f.md` and capturing the display name at sign-up
moved to `prd-DISC-001-01e.md`. Requirement IDs were renumbered; the parent index maps every
original ID to its new one.

## Goals
- A profile screen with display name, email and 2FA status.
- Editable preferences: default rate type, display currency, time zone and interface language.
- A shared amount formatter that follows the interface language, for every later screen.

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
- FR-08: The system must provide an amount formatter that formats amounts in minor units with the
  conventions of the interface language, without floating point.

## Non-Functional Requirements
- NFR-01: Saving the profile or a preference must answer in < 300 ms at p95, measured
  server-side.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user opens their profile, THE system SHALL show their display name (an
  empty field when none was ever set), their email and whether 2FA is enabled.
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
  every screen in English.
- AC-10 (FR-08): WHEN the amount formatter receives 155730 minor units, THE system SHALL return
  `1,557.30` for English and `1.557,30` for Spanish.

## Out of Scope
- Changing the account email.
- Theme selection (PRD 09 covers it).
- Account deletion (DISC-001-01f).
- Capturing the display name at sign-up (DISC-001-01e); until then an existing account has no
  display name.
- Showing amounts on any screen of this ticket; visual verification of the amount formatting is
  deferred to the screens of PRD 02 (Accounts), the first to show amounts.
- Redirecting a user to their saved interface language after sign-in.

## Risks and Mitigations
- **Other modules read stale preferences** → preferences are read from the user record on every
  request, never cached in process memory (AGENTS.md: stateless API).
- **Amounts formatted with a float lose cents or digits** → the formatter works on integers only
  and AC-10 is verified by unit tests, including amounts above 2^53.
- **A display name that was never set breaks the screen** → AC-01 requires an empty field, and
  AC-02 sets it.

## Dependencies
- DISC-001-01a (Email & Password Authentication) — accounts, sessions, stored defaults, the
  formatting conventions of its NFR-10.
- DISC-001-01c (Two-Factor Authentication) — 2FA status shown in the profile (FR-01); merged to
  main.
- Exchange rate types catalog, defined in PRD 03 (Movements & Exchange Rates) — FR-04.
- IANA time zone database — FR-06.
- PRD 02 (Accounts) — first screens that show amounts (deferral in Out of Scope).
- PRD 09 — theme selection (Out of Scope).

## Decision Log
- 2026-09-26: Split from DISC-001-01 (user decision).
- 2026-09-26: NFR-01 made explicit when splitting; confirmed by the user.
- 2026-09-26: User approved this sub-PRD and the non-functional requirements added when splitting.
- 2026-10-01: PLAN review showed that new requirements (second factor and Google re-authentication
  for deletion, display name at sign-up) would put this ticket at about 26 acceptance criteria.
  User decision: split it three ways. This PRD keeps profile and preferences; account deletion
  moved to DISC-001-01f (old FR-08, AC-10, AC-11, NFR-02, with the new requirements) and the
  display name at sign-up to DISC-001-01e.
- 2026-10-01: DISC-001-01c is merged, so 2FA status is read from its real code and no stub is
  used (user decision, D-5). The migration of this ticket is numbered 0006 because 01c owns 0005;
  DISC-001-02a is also planned in parallel and claims the next number, so whichever of the two
  merges later renumbers its migration (user decision, D-6).
- 2026-10-01: Display name (D-3): existing accounts keep no display name until the user sets one
  in the profile, and the interface handles the empty value (AC-01). Capturing it at sign-up is
  DISC-001-01e.
- 2026-10-01: Amount formatting (D-4): AC-09 is split into the language switch (AC-09) and the
  formatter (FR-08, AC-10), verified by unit tests of the shared formatter only; no example amount
  is shown on any screen, and visual verification is deferred to PRD 02's screens (user decision).
- 2026-10-01: User confirmed that there is no redirect to the saved language after sign-in, and
  that the naming `DeleteUser`, `UserDeletionRepository` and `/profile/delete` (used by
  DISC-001-01f) stands.
