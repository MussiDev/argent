# PRD DISC-001-01f: Account Deletion

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01f |
| Tracker | none |
| Date | 2026-10-01 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Sixth sub-ticket of Identity & Access (parent index: `prd-DISC-001-01.md`). Users have the right to
delete their account and personal data. Deletion is irreversible, so it needs a strong
re-authentication: the account password, plus the second factor for users who enabled 2FA
(DISC-001-01c). Accounts created through Google have no password, so they re-authenticate by
signing in with Google again (DISC-001-01b). The original deletion requirement came from
DISC-001-01d and was moved here when that ticket was split (user decision, 2026-10-01).

## Goals
- Permanent deletion of an account and its personal data after a strong re-authentication.
- Re-authentication that matches how the user signs in: password, password and second factor, or
  Google.
- A stolen session, a stolen password or a stolen Google session alone cannot delete an account
  that has 2FA.

## Functional Requirements
- FR-01: The system must allow a user to permanently delete their account and all their personal
  data, after re-authenticating.
- FR-02: The system must require the account password to re-authenticate a user who has a
  password. *(Pending human confirmation: the agent's default for a user who has both a password
  and a linked Google identity is that the password is required and a Google re-authentication is
  not accepted.)*
- FR-03: The system must also require a valid TOTP code or an unused recovery code from a user who
  has 2FA enabled, whatever the other re-authentication was.
- FR-04: The system must require a user without a password (an account created through Google) to
  re-authenticate by signing in with Google again, through a single-use deletion grant that is
  issued only after Google confirms the identity linked to that account and is bound to that
  deletion request.

## Non-Functional Requirements
- NFR-01: After an account deletion, 0 rows of the data listed in AC-01 must remain for that
  user, verified by an automated test.
- NFR-02: A failed password re-authentication must count toward the sign-in limits of
  DISC-001-01a NFR-03 (5 failed attempts per account and 20 per IP per 15 minutes), and failed
  second-factor codes at deletion must be limited to 5 per user per 15 minutes and 20 per user per
  24 hours, as DISC-001-01c does when disabling 2FA.
- NFR-03: A deletion grant must expire 5 minutes after it is issued, be usable once, and be valid
  only for the user and the session that started the Google re-authentication. *(The 5 minutes
  are pending human confirmation: the agent's proposal.)*
- NFR-04: 100% of Google ID tokens used to issue a deletion grant must be verified (signature,
  audience, issuer, expiry and nonce, as in DISC-001-01b NFR-02), the OAuth state, nonce and PKCE
  protections of DISC-001-01b must apply unchanged, and Google must be asked to authenticate the
  user again instead of reusing its session silently.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user confirms account deletion after re-authenticating, THE system SHALL
  delete their personal data — profile, credentials, linked Google identity, 2FA secrets and
  recovery codes, preferences, sessions, and every financial record they own that is not shared
  with a group — and end all their sessions.
- AC-02 (FR-02): IF the password entered to confirm an account deletion is wrong, THEN THE system
  SHALL not delete the account and SHALL count it as a failed sign-in attempt.
- AC-03 (FR-03): WHEN a user with 2FA enabled confirms account deletion with the correct
  re-authentication and a valid TOTP code or an unused recovery code, THE system SHALL delete the
  account.
- AC-04 (FR-03): IF a user with 2FA enabled confirms account deletion without a second factor,
  with an invalid TOTP code or with an already used recovery code, THEN THE system SHALL not
  delete the account and SHALL count a wrong code as a failed second-factor attempt.
- AC-05 (NFR-02): IF a user fails 5 second-factor codes at deletion within 15 minutes, THEN THE
  system SHALL refuse further deletion attempts of that user with 429 Too Many Requests until the
  window passes, without checking the code.
- AC-06 (FR-04): WHEN a user without a password starts an account deletion, THE system SHALL send
  them to Google to authenticate again and, only after Google returns a verified identity that
  matches the Google account linked to their account, SHALL issue a deletion grant.
- AC-07 (FR-04): IF the Google authentication fails, is cancelled, returns an identity other than
  the one linked to the account, or arrives with an unknown, used or expired state or with a
  binding that does not match the browser, THEN THE system SHALL issue no deletion grant and
  delete nothing.
- AC-08 (FR-04): WHEN a user without a password presents a valid deletion grant (and a valid
  second factor when 2FA is enabled), THE system SHALL delete the account and SHALL consume the
  grant.
- AC-09 (FR-04): IF a deletion grant is expired, already used, or was issued to another user or
  another session, THEN THE system SHALL reject the deletion with 401 Unauthorized and delete
  nothing.
- AC-10 (FR-02): WHILE a user has both a password and a linked Google identity, THE system SHALL
  require the password to confirm account deletion and SHALL not accept a Google deletion grant.
  *(Pending human confirmation.)*

## Out of Scope
- Data export before deletion.
- What happens to group-shared movements of a deleted user (PRD 05).
- Undoing an account deletion.
- Notifying the user by email that the account was deleted (user decision, 2026-10-01).
- Re-authentication by email link or by any method other than password, second factor and Google.
- Recovery for users who lost both their authenticator and their recovery codes (DISC-001-01c).

## Risks and Mitigations
- **Accidental deletion** → strong re-authentication before deletion (FR-02, FR-03, FR-04,
  AC-02).
- **A stolen session, or a stolen password, deletes a 2FA account** → the second factor is
  required whatever the other re-authentication (FR-03, AC-04) with its own limits (NFR-02).
- **Replay or theft of the Google re-authentication** → single-use grant that expires and is bound
  to the user and the session (NFR-03, AC-09), plus the state, nonce and PKCE of 01b (NFR-04,
  AC-07).
- **A silent Google session counts as a fresh authentication** → Google is asked to authenticate
  again (NFR-04).
- **Personal data left behind** → explicit list of deleted data (AC-01) and a zero-rows test
  (NFR-01).

## Dependencies
- DISC-001-01a (Email & Password Authentication) — accounts, sessions, sign-in rate limits.
- DISC-001-01b (Google Sign-In) — the OAuth flow and protections reused for the Google
  re-authentication.
- DISC-001-01c (Two-Factor Authentication) — TOTP and recovery code checks and their limits.
- DISC-001-01d (Profile & Preferences) — the profile screen that links to deletion.
- PRD 05 (Groups & Expense Splitting) — group records of deleted users.

## Decision Log
- 2026-10-01: Created when DISC-001-01d was split in three (user decision). The old FR-08, AC-10,
  AC-11 and NFR-02 of DISC-001-01d moved here as FR-01, AC-01, AC-02 and NFR-01.
- 2026-10-01: User decisions on re-authentication. D-1: a user with 2FA enabled needs the password
  and a valid second factor (TOTP code or recovery code), consistent with the rules and attempt
  limits of DISC-001-01c. D-2: a user without a password re-authenticates by signing in with Google
  again, through a short-lived, single-use deletion grant bound to the deletion intent, reusing the
  OAuth flow and the state, nonce and PKCE protections of DISC-001-01b; if that user also has 2FA,
  the second factor is still required. These are new requirements (FR-03, FR-04, NFR-02 to NFR-04
  and AC-03 to AC-09).
- 2026-10-01: User decisions: no email notice after deletion (Out of Scope); the naming
  `DeleteUser`, `UserDeletionRepository` and the route `/profile/delete` is confirmed.
- 2026-10-01: Pending human confirmation, agent defaults that do not block DISC-001-01d: a user who
  has both a password and a linked Google identity deletes with the password (FR-02, AC-10); and
  the deletion grant expires after 5 minutes (NFR-03).
- 2026-10-01: Scope re-assessment to do when this PRD is planned: it has 4 FR, 4 NFR and 10 AC in
  one module (identity). If it still looks too big, it can be split into password and second
  factor (AC-01 to AC-05, AC-10) and Google re-authentication (AC-06 to AC-09).
