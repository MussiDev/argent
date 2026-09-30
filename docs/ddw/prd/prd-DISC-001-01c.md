# PRD DISC-001-01c: Two-Factor Authentication

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01c |
| Tracker | none |
| Date | 2026-09-26 |
| PRD loops | 2 |
| Loops since last human decision | 0 |

## Context and Problem
Third sub-ticket of Identity & Access (parent index: `prd-DISC-001-01.md`). A stolen password must
not be enough to read someone's finances. Users can opt into a second factor with an
authenticator app, and need a way back in if they lose their phone. Split from `prd-DISC-001-01.md` (2026-09-26, user decision). Requirement IDs were renumbered; the parent index maps every original ID to its new one.

## Goals
- Optional TOTP second factor, enabled and disabled by the user.
- One-time recovery codes for when the authenticator is lost.
- The second factor is protected by the same brute-force limits as the password.

## Functional Requirements
- FR-01: The system must allow a user to enable TOTP-based two-factor authentication
  (authenticator app).
- FR-02: The system must allow a user with 2FA enabled to disable it.
- FR-03: The system must issue 10 one-time recovery codes when a user enables 2FA.
- FR-04: The system must ask users with 2FA enabled for a valid TOTP code or an unused recovery
  code after any first factor (password or Google sign-in), before starting the session.

## Non-Functional Requirements
- NFR-01: Every invalid TOTP or recovery code must count toward the sign-in rate limit of
  DISC-001-01a NFR-03 (5 failed attempts per account per 15 minutes).
- NFR-02: Recovery codes must be stored only as Argon2id hashes, with 0 codes stored in plain text.
- NFR-03: TOTP must follow RFC 6238 with 6-digit codes, a 30-second step and a tolerance of 1 step
  before and after.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user enables 2FA and confirms a valid TOTP code, THE system SHALL
  activate 2FA for that account.
- AC-02 (FR-03): WHEN 2FA is activated, THE system SHALL display 10 one-time recovery codes once
  and SHALL not display them again afterwards.
- AC-03 (FR-02): WHEN a user disables 2FA after entering a valid TOTP code, THE system SHALL
  deactivate 2FA and invalidate the recovery codes.
- AC-04 (FR-04): WHEN a user with 2FA enabled passes the first factor, THE system SHALL request
  a TOTP code or recovery code before starting the session.
- AC-05 (FR-04): IF a user enters an invalid TOTP code or an already used recovery code, THEN
  THE system SHALL reject it and count it as a failed sign-in attempt.
- AC-06 (FR-04): WHEN a user with 2FA enabled completes Google sign-in, THE system SHALL request
  a TOTP code or recovery code before starting the session.

## Out of Scope
- SMS or email second factors; passkeys / WebAuthn.
- Mandatory 2FA for all users.
- Regenerating recovery codes without disabling and re-enabling 2FA.
- Recovery for users who lost both their authenticator and their recovery codes.

## Risks and Mitigations
- **Users lock themselves out** → recovery codes shown once at activation (AC-02).
- **Brute force of 6-digit codes** → shared rate limit (NFR-01).
- **Recovery codes leaked from the database** → hashed at rest (NFR-02).

## Dependencies
- DISC-001-01a (Email & Password Authentication) — sign-in flow, sessions, rate limiting.
- DISC-001-01b (Google Sign-In) — the second first factor that FR-04 also covers.

## Decision Log
- 2026-09-26: Split from DISC-001-01 (user decision).
- 2026-09-26: NFR-02 (hashed recovery codes) and NFR-03 (RFC 6238 parameters) made explicit when
  splitting; confirmed by the user.
- 2026-09-26: User approved this sub-PRD and the non-functional requirements added when splitting.
- 2026-09-30: Google sign-in (DISC-001-01b) shipped after this PRD was split, and FR-04 did not say
  whether it is a first factor. User decision: 2FA applies after any first factor, password or
  Google (FR-04 reworded, AC-06 added), so a stolen Google account does not bypass 2FA.
