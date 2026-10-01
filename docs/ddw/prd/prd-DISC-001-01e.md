# PRD DISC-001-01e: Display Name at Sign-Up

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01e |
| Tracker | none |
| Date | 2026-10-01 |
| PRD loops | 1 |
| Loops since last human decision | 0 |

## Context and Problem
Fifth sub-ticket of Identity & Access (parent index: `prd-DISC-001-01.md`). DISC-001-01d lets a
user see and edit a display name, but no sign-up captures one, so every account starts without it.
New accounts should come with a name: the registration form asks for it, and a Google sign-up takes
it from the Google profile. This changes the registration of DISC-001-01a (API, schema and screen)
and the account creation of DISC-001-01b. Created on 2026-10-01 when DISC-001-01d was split (user
decision).

## Goals
- Every account created by email and password has a display name from the first day.
- Every account created through Google gets the name from the Google profile when Google gives
  one.
- Existing accounts and the anti-enumeration behavior of registration are not affected.

## Functional Requirements
- FR-01: The system must require a display name when a visitor registers with an email address and
  a password.
- FR-02: The system must store the display name on the account it creates and show it in the
  profile of DISC-001-01d.
- FR-03: The system must show a required display name field on the registration screen.
- FR-04: The system must set the display name of an account created through Google from the
  `name` claim of the Google ID token.
- FR-05: The system must create an account without a display name when the `name` claim is
  missing or empty, and must truncate a `name` longer than 50 characters to its first 50
  characters.
- FR-06: The system must leave the display name unchanged when Google is linked to an existing
  account and when an existing Google user signs in.

## Non-Functional Requirements
- NFR-01: Registration with the new field must still answer in < 500 ms at p95, measured
  server-side (DISC-001-01a NFR-06).
- NFR-02: Registration must keep returning 100% identical status codes and bodies for existing and
  non-existing emails when the display name is valid (DISC-001-01a NFR-08), and a missing or
  invalid display name must be rejected before the system looks at the email.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a visitor registers with an email, a password and a display name between 1
  and 50 characters, THE system SHALL create the account with that display name, trimmed of
  surrounding spaces.
- AC-02 (FR-01): IF a registration request has no display name, a display name that is empty
  after trimming, or one longer than 50 characters, THEN THE system SHALL reject it with 400 Bad
  Request, create no account and send no email.
- AC-03 (FR-02): WHEN a user who registered with a display name opens their profile, THE system
  SHALL show that display name.
- AC-04 (FR-03): WHEN a visitor opens the registration screen, THE system SHALL show a display
  name field marked as required and SHALL not submit the form while it is empty.
- AC-05 (FR-04): WHEN an account is created through Google and the `name` claim has between 1 and
  50 characters, THE system SHALL store it as the display name.
- AC-06 (FR-05): WHEN an account is created through Google and the `name` claim is missing or
  empty, THE system SHALL create the account with no display name.
- AC-07 (FR-05): WHEN an account is created through Google and the `name` claim is longer than 50
  characters, THE system SHALL store its first 50 characters as the display name.
- AC-08 (FR-06): WHEN Google is linked to an existing account, or a user whose account is already
  linked signs in with Google, THE system SHALL leave the display name of that account unchanged.
- AC-09 (NFR-02): IF a visitor registers with an already registered email and a valid display
  name, THEN THE system SHALL answer with the same status code and body as for an unregistered
  email.

## Out of Scope
- Giving a display name to existing accounts (they keep none until the user sets one in
  DISC-001-01d).
- Asking existing users to set a name after sign-in.
- Changing the display name (DISC-001-01d).
- Uniqueness of display names.
- Any other Google profile data (picture, locale).

## Risks and Mitigations
- **The new field leaks whether an email exists** → the name is validated before the email is
  looked up and the answer stays identical (NFR-02, AC-09).
- **A very long Google name breaks the 1 to 50 character rule of DISC-001-01d** → truncation to 50
  characters (FR-05).
- **Registration clients that do not send a name stop working** → the web app is the only client
  and ships the field in the same change (FR-03).

## Dependencies
- DISC-001-01d (Profile & Preferences) — the `display_name` storage and the profile screen.
- DISC-001-01a (Email & Password Authentication) — registration API, schema and screen, and its
  NFR-06 and NFR-08.
- DISC-001-01b (Google Sign-In) — account creation from Google claims.

## Decision Log
- 2026-10-01: Created when DISC-001-01d was split in three (user decision). Display name (D-3): for
  Google sign-ups it comes from the Google profile `name` claim at account creation; for
  email/password sign-ups the registration form requires a name, which modifies the registration
  API, schema and screen of DISC-001-01a (user decision). Existing users keep no name until they
  set it in the profile.
- 2026-10-01: The user confirmed the defaults that the PRD had marked as pending (human decision): a
  Google `name` that is missing or empty gives an account with no display name, and one longer than
  50 characters is truncated to its first 50 characters (FR-05, AC-06, AC-07). They no longer block
  anything.
