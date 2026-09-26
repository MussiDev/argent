# PRD DISC-001-01: Identity & Access

| Field | Value |
|-------|-------|
| Ticket | DISC-001 |
| Tracker | none |
| Date | 2026-09-25 |
| PRD loops | 6 |
| Loops since last human decision | 0 |

## Context and Problem
The finance PWA (see `docs/ddw/discovery/concept-DISC-001.md`) stores personal financial data
and lets users share expenses with other users in groups. Every other module needs to know who
the user is, and must guarantee that nobody sees financial data that is not theirs. The product
is public with open registration, with an initial reach of about 10 users and room to grow.

## Goals
- Let anyone create an account and sign in, with Google or with email and password.
- Protect accounts with a level of security appropriate for financial data (verified email,
  optional 2FA, brute-force protection).
- Hold the user preferences that other modules read (default exchange rate type, display
  currency).
- Guarantee that each user can only access their own data.

## Functional Requirements
- FR-01: The system must allow any visitor, without an invitation, to register with an email
  address and a password (decision 2026-09-25: open registration).
- FR-02: The system must require the user to verify their email address, through a link sent by
  email, before granting access to any financial data.
- FR-03: The system must allow a visitor without an account to register with a Google account
  (OAuth 2.0 / OpenID Connect).
- FR-14: The system must allow a user whose account is linked to a Google identity to sign in
  with that Google account.
- FR-15: The system must treat as verified the email of an account created through Google when
  Google reports that email as verified (`email_verified = true`).
- FR-04: The system must allow a registered user to sign in with email and password.
- FR-05: The system must allow a user to reset a forgotten password through a single-use link
  sent to their verified email.
- FR-06: The system must allow a user to enable TOTP-based two-factor authentication
  (authenticator app).
- FR-16: The system must allow a user with 2FA enabled to disable it.
- FR-17: The system must issue 10 one-time recovery codes when a user enables 2FA.
- FR-07: The system must ask users with 2FA enabled for a valid TOTP code or an unused recovery
  code after the first factor, before starting the session.
- FR-08: The system must allow a user to sign out of the current session.
- FR-18: The system must allow a user to sign out of all their sessions at once.
- FR-19: The system must allow a user to view their profile: display name, email and 2FA status.
- FR-09: The system must allow a user to edit their display name.
- FR-20: The system must not allow a user to change the email of their account.
- FR-10: The system must allow a user to set their default exchange rate type (one of oficial,
  blue, bolsa/MEP, contado con liquidación, mayorista, cripto, tarjeta).
- FR-21: The system must allow a user to set their display currency (ARS or USD).
- FR-22: The system must set MEP as the default exchange rate type and ARS as the display
  currency of every new account.
- FR-11: The system must link a Google sign-in to an existing account when the Google email
  matches that account's verified email, instead of creating a duplicate account.
- FR-12: The system must allow a user to permanently delete their account and all their personal
  data, after re-authenticating.
- FR-13: The system must reject any request for financial data that carries no valid session.
- FR-23: The system must reject any read, update or delete of financial data that the requesting
  user does not own and that is not shared with them through a group.
- FR-24: The system must allow a user to set their time zone, chosen from the IANA time zone
  database (for example `America/Argentina/Buenos_Aires`).
- FR-25: The system must set the time zone of a new account to the time zone reported by the
  user's device, or to `America/Argentina/Buenos_Aires` when the device reports none.
- FR-26: The system must allow a user to set their interface language: Spanish or English.
- FR-27: The system must set the language of a new account to the device's language when it is
  Spanish or English, and to Spanish otherwise.

## Non-Functional Requirements
- NFR-01: Passwords must be hashed with Argon2id (OWASP-recommended parameters: m ≥ 19 MiB,
  t ≥ 2, p = 1). Passwords must never be stored or logged in plain text.
- NFR-02: Passwords must be at least 10 characters long, and must be rejected if they appear in a
  known breached-password list (e.g. the Have I Been Pwned k-anonymity API).
- NFR-03: Sign-in must be rate-limited to 5 failed attempts per account per 15 minutes and 20
  failed attempts per IP per 15 minutes; registration to 5 accounts per IP per hour.
- NFR-04: Email verification links must expire after 24 hours; password reset links after 60
  minutes. Both must be single-use.
- NFR-05: Sessions must use a short-lived access token (≤ 15 minutes) and a rotating refresh
  token (≤ 30 days of inactivity), stored in `HttpOnly`, `Secure`, `SameSite=Strict` cookies.
- NFR-06: Email/password sign-in, registration and the Google OAuth callback handling must each
  answer in < 500 ms at p95, measured server-side from request received to response sent. Time
  spent on Google's own screens and on email delivery is outside the system's control and is not
  part of this metric.
- NFR-07: All traffic must use TLS 1.2 or higher. HTTP requests must be redirected to HTTPS.
- NFR-08: Sign-in, registration and password reset must return 100% identical status codes and
  bodies for existing and non-existing emails. To keep response times indistinguishable, the
  system must run one Argon2id verification against a fixed dummy hash when the email does not
  exist, so the median response-time difference stays < 50 ms.
- NFR-09: A session created on one instance of the authentication service must be accepted by
  any other instance in 100% of requests, verified in a test with 2 instances behind a load
  balancer (concept decision: design for scalability — no session state in process memory).
- NFR-10: 100% of interface texts must exist in Spanish and English, and amounts and dates must
  be formatted with the conventions of the selected language (Spanish: `es-AR`, for example
  1.557,30 and 25/09/2026; English: `en-US`, for example 1,557.30 and 09/25/2026).

## Acceptance Criteria
- AC-01 (FR-01): WHEN a visitor submits a valid email and a valid password on the registration
  form, THE system SHALL create an unverified account and send a verification email.
- AC-02 (FR-01): IF a visitor submits a password shorter than 10 characters or one found in the
  breached-password list, THEN THE system SHALL reject the registration and show which rule
  failed.
- AC-36 (FR-01): IF a visitor submits the registration form with an email that already has an
  account, THEN THE system SHALL show the same confirmation as AC-01 and SHALL not create a
  second account.
- AC-03 (FR-02): WHILE a user's email is unverified, THE system SHALL deny access to every
  financial data screen and endpoint and show a "verify your email" screen with a resend option.
- AC-04 (FR-02): WHEN a user opens a valid verification link, THE system SHALL mark the email as
  verified and grant access to financial data.
- AC-05 (FR-02): IF a user opens a verification link that is expired or already used, THEN THE
  system SHALL reject it and offer to send a new one.
- AC-06 (FR-03): WHEN a visitor completes Google sign-in with an email that has no account, THE
  system SHALL create an account linked to that Google identity and start a session.
- AC-07 (FR-03): IF the Google OAuth flow fails or is cancelled, THEN THE system SHALL return to
  the sign-in screen with the message "Google sign-in failed. Please try again." and
  create no account.
- AC-26 (FR-14): WHEN a user whose account is linked to a Google identity completes Google
  sign-in, THE system SHALL start a session on that existing account and SHALL not create a new
  account.
- AC-27 (FR-15): WHEN an account is created through Google and Google reports
  `email_verified = true`, THE system SHALL mark the email as verified and SHALL not send a
  verification email.
- AC-37 (FR-15): IF Google reports `email_verified = false` for a new account, THEN THE system
  SHALL create the account as unverified and send a verification email.
- AC-08 (FR-04): WHEN a verified user submits a correct email and password and has no 2FA, THE
  system SHALL start a session.
- AC-09 (FR-04): IF a user submits wrong credentials, THEN THE system SHALL reject the sign-in
  with a generic "invalid email or password" message.
- AC-10 (FR-05): WHEN a user requests a password reset, THE system SHALL send a single-use reset
  link to the email if it is registered, and show the same confirmation message in either case.
- AC-11 (FR-05): WHEN a user sets a new valid password through a valid reset link, THE system
  SHALL update the password and end all of that user's existing sessions.
- AC-35 (FR-05): IF a user opens a password reset link older than 60 minutes or already used,
  THEN THE system SHALL reject it, leave the password unchanged and offer to request a new one.
- AC-12 (FR-06): WHEN a user enables 2FA and confirms a valid TOTP code, THE system SHALL
  activate 2FA for that account.
- AC-28 (FR-17): WHEN 2FA is activated, THE system SHALL display 10 one-time recovery codes once
  and SHALL not display them again afterwards.
- AC-13 (FR-16): WHEN a user disables 2FA after entering a valid TOTP code, THE system SHALL
  deactivate 2FA and invalidate the recovery codes.
- AC-14 (FR-07): WHEN a user with 2FA enabled passes the first factor, THE system SHALL request
  a TOTP code or recovery code before starting the session.
- AC-15 (FR-07): IF a user enters an invalid TOTP code or an already used recovery code, THEN
  THE system SHALL reject it and count it as a failed sign-in attempt.
- AC-16 (FR-08): WHEN a user signs out, THE system SHALL revoke the current refresh token and
  clear the session cookies.
- AC-17 (FR-18): WHEN a user chooses "sign out of all sessions", THE system SHALL revoke every
  refresh token of that user.
- AC-30 (FR-19): WHEN a user opens their profile, THE system SHALL show their display name,
  email and whether 2FA is enabled.
- AC-18 (FR-09): WHEN a user saves a display name between 1 and 50 characters, THE system SHALL
  persist it and show it in the profile.
- AC-29 (FR-09): IF a user saves an empty display name or one longer than 50 characters, THEN
  THE system SHALL reject it and keep the previous name.
- AC-31 (FR-20): IF a profile update request includes an email different from the account's
  email, THEN THE system SHALL reject it with 400 Bad Request and leave the email unchanged.
- AC-19 (FR-10): WHEN a user saves a default exchange rate type, THE system SHALL persist it and
  show the saved value in the preferences screen after the user signs out and signs in again.
- AC-32 (FR-21): WHEN a user saves a display currency, THE system SHALL persist it and show the
  saved value in the preferences screen after the user signs out and signs in again.
- AC-20 (FR-22): WHEN a new account is created, THE system SHALL set the default exchange rate
  type to MEP and the display currency to ARS.
- AC-21 (FR-11): WHEN a user signs in with Google using an email that matches an existing
  verified account, THE system SHALL link the Google identity to that account and start a
  session on it.
- AC-22 (FR-11): IF the Google email matches an existing account whose email is unverified, THEN
  THE system SHALL not link the accounts and SHALL ask the user to verify the email first.
- AC-23 (FR-12): WHEN a user confirms account deletion after re-authenticating, THE system SHALL
  delete their personal data — profile, credentials, linked Google identity, 2FA secrets and
  recovery codes, preferences, sessions, and every financial record they own that is not shared
  with a group — and end all their sessions.
- AC-38 (FR-12): IF the re-authentication before account deletion fails, THEN THE system SHALL
  not delete the account and SHALL count it as a failed sign-in attempt.
- AC-24 (FR-13): IF a request for financial data has no valid session, THEN THE system SHALL
  answer 401 Unauthorized.
- AC-25 (FR-23): IF an authenticated user requests to read data owned by another user and not
  shared with them through a group, THEN THE system SHALL answer 404 Not Found without revealing
  that the data exists.
- AC-33 (FR-23): IF an authenticated user requests to update or delete data owned by another
  user and not shared with them through a group, THEN THE system SHALL answer 404 Not Found and
  leave the data unchanged.
- AC-34 (FR-23): WHEN an authenticated user requests data shared with them through a group they
  belong to, THE system SHALL return that data.
- AC-39 (FR-24): WHEN a user saves the time zone `Europe/Madrid`, THE system SHALL persist it and
  show it in the preferences screen.
- AC-40 (FR-24): IF a user submits a time zone that is not in the IANA time zone database, THEN
  THE system SHALL reject it and keep the previous one.
- AC-41 (FR-25): WHEN an account is created from a device that reports `America/Cordoba`, THE
  system SHALL set the account's time zone to `America/Cordoba`.
- AC-42 (FR-25): IF the device reports no time zone when an account is created, THEN THE system
  SHALL set the account's time zone to `America/Argentina/Buenos_Aires`.
- AC-43 (FR-26): WHEN a user switches the interface language to English, THE system SHALL show
  every screen in English and format amounts as 1,557.30.
- AC-44 (FR-27): WHEN an account is created from a device whose language is English, THE system
  SHALL set the interface language to English.
- AC-45 (FR-27): IF the device's language is neither Spanish nor English when an account is
  created, THEN THE system SHALL set the interface language to Spanish.

## Out of Scope
- Passkeys / WebAuthn (candidate for a future PRD).
- Sign-in providers other than Google (Apple, Microsoft, GitHub, etc.).
- SMS or email-based 2FA codes.
- Changing the account email.
- Invite-only registration mode.
- Admin panel or user management by an operator.
- Account recovery for users who lost access to both their email and their 2FA recovery codes.
- Group membership and invitations (PRD 05, Groups & Expense Splitting).
- What happens to group-shared movements when a member deletes their account (PRD 05).

## Risks and Mitigations
- **Open registration attracts bots and junk accounts** → mandatory email verification before
  data access (FR-02), registration rate limit per IP (NFR-03). A CAPTCHA can be added if abuse
  shows up in production.
- **Credential stuffing / brute force** → rate limiting (NFR-03), breached-password check
  (NFR-02), optional 2FA (FR-06), no account enumeration (NFR-08).
- **Verification and reset emails land in spam** → use a transactional email provider with SPF,
  DKIM and DMARC configured.
- **Account takeover through Google linking** → link only to verified emails (AC-21, AC-22).
- **Deleting a user who has shared expenses in groups** → how their group movements are kept
  (anonymized vs removed) depends on PRD 05; this PRD deletes personal data and defers the group
  impact to that PRD.

## Dependencies
- Google Identity (OAuth 2.0 / OpenID Connect) — FR-03, FR-14, FR-15, FR-11.
- Transactional email provider (to be chosen in PLAN) — FR-02, FR-05.
- Have I Been Pwned Pwned Passwords API (k-anonymity range endpoint) — NFR-02.
- Exchange rate types catalog, defined in PRD 03 (Movements & Exchange Rates) — FR-10.
- IANA time zone database — FR-24, FR-25.
- Group sharing rules, defined in PRD 05 (Groups & Expense Splitting) — FR-23, FR-12.

## Decision Log
- 2026-09-25: Audit against the user's checklist (atomic FRs, measurable NFRs, FR coverage,
  binary ACs, explicit scope, access control). Approved corrections: compound FRs split into
  atomic ones (new IDs appended, existing IDs kept for traceability), hidden rules rewritten with
  "must", NFR-06/08/09 made measurable and achievable, missing and non-binary ACs added or
  rewritten, access control extended to update/delete and the shared-data positive case.
  Acceptance criteria kept in EARS format (DDW rule F-PRD-09) pending the user's choice of format.
- 2026-09-25: User approved this version with acceptance criteria in EARS format.
- 2026-09-25: User decision: per-user time zone, mandatory. Dates and scheduled times are
  computed in the user's time zone (PRD 01, FR-24).
- 2026-09-25: User decision: the interface is bilingual, Spanish and English.
