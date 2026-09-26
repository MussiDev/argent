# PRD DISC-001-01b: Google Sign-In

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01b |
| Tracker | none |
| Date | 2026-09-26 |
| PRD loops | 1 |
| Loops since last human decision | 0 |

## Context and Problem
Second sub-ticket of Identity & Access (parent index: `prd-DISC-001-01.md`). Many users prefer not
to create another password; delegating authentication to Google also reduces the attack surface
of an app that holds financial data. Accounts created with email and password (DISC-001-01a) must
be linkable, never duplicated. Split from `prd-DISC-001-01.md` (2026-09-26, user decision). Requirement IDs were renumbered; the parent index maps every original ID to its new one.

## Goals
- Register and sign in with a Google account.
- Treat Google-verified emails as verified.
- Link Google to an existing verified account instead of duplicating it, without enabling account
  takeover.

## Functional Requirements
- FR-01: The system must allow a visitor without an account to register with a Google account
  (OAuth 2.0 / OpenID Connect).
- FR-02: The system must allow a user whose account is linked to a Google identity to sign in
  with that Google account.
- FR-03: The system must treat as verified the email of an account created through Google when
  Google reports that email as verified (`email_verified = true`).
- FR-04: The system must link a Google sign-in to an existing account when the Google email
  matches that account's verified email, instead of creating a duplicate account.

## Non-Functional Requirements
- NFR-01: Handling the Google OAuth callback must answer in < 500 ms at p95, measured server-side
  from request received to response sent; time spent on Google's own screens is not part of this
  metric.
- NFR-02: 100% of Google ID tokens must be verified (signature, audience, issuer and expiry)
  before an account is created, linked or signed in.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a visitor completes Google sign-in with an email that has no account, THE
  system SHALL create an account linked to that Google identity and start a session.
- AC-02 (FR-01): IF the Google OAuth flow fails or is cancelled, THEN THE system SHALL return to
  the sign-in screen with the message "Google sign-in failed. Please try again." and
  create no account.
- AC-03 (FR-02): WHEN a user whose account is linked to a Google identity completes Google
  sign-in, THE system SHALL start a session on that existing account and SHALL not create a new
  account.
- AC-04 (FR-03): WHEN an account is created through Google and Google reports
  `email_verified = true`, THE system SHALL mark the email as verified and SHALL not send a
  verification email.
- AC-05 (FR-03): IF Google reports `email_verified = false` for a new account, THEN THE system
  SHALL create the account as unverified and send a verification email.
- AC-06 (FR-04): WHEN a user signs in with Google using an email that matches an existing
  verified account, THE system SHALL link the Google identity to that account and start a
  session on it.
- AC-07 (FR-04): IF the Google email matches an existing account whose email is unverified, THEN
  THE system SHALL not link the accounts and SHALL ask the user to verify the email first.

## Out of Scope
- Sign-in providers other than Google (Apple, Microsoft, GitHub, etc.).
- Unlinking Google from an account.
- Two-factor authentication (DISC-001-01c).

## Risks and Mitigations
- **Account takeover through linking** → link only to verified emails (AC-06, AC-07).
- **Forged or replayed tokens** → full ID token verification (NFR-02).
- **Google outage or cancelled consent** → return to sign-in with an error, create nothing
  (AC-02).

## Dependencies
- DISC-001-01a (Email & Password Authentication) — accounts, sessions, email verification.
- Google Identity (OAuth 2.0 / OpenID Connect) — FR-01 to FR-04.

## Decision Log
- 2026-09-26: Split from DISC-001-01 (user decision).
- 2026-09-26: NFR-02 (ID token verification) made explicit when splitting; it was implied by the
  OpenID Connect dependency of the original PRD.
- 2026-09-26: User approved this sub-PRD and the non-functional requirements added when splitting.
