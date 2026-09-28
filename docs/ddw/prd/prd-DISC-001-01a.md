# PRD DISC-001-01a: Email & Password Authentication

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01a |
| Tracker | none |
| Date | 2026-09-26 |
| PRD loops | 1 |
| Loops since last human decision | 0 |

## Context and Problem
First sub-ticket of Identity & Access (parent index: `prd-DISC-001-01.md`). The finance PWA
(`docs/ddw/discovery/concept-DISC-001.md`) stores personal financial data, so every other module
needs to know who the user is and must never expose one user's data to another. This sub-ticket
delivers email/password accounts, sessions and access control, and it is the first code in the
repository, so it also lays the project foundation declared in `AGENTS.md` (monorepo, web app,
API, database). Split from `prd-DISC-001-01.md` (2026-09-26, user decision). Requirement IDs were renumbered; the parent index maps every original ID to its new one.

## Goals
- Let anyone register with email and password, verify the email and sign in.
- Sessions and password reset with a security level appropriate for financial data.
- Access control that every later module reuses: no session gives 401; someone else's data gives
  404.
- Store the defaults every account needs from day one (rate type, display currency, time zone,
  language).

## Functional Requirements
- FR-01: The system must allow any visitor, without an invitation, to register with an email
  address and a password (decision 2026-09-25: open registration).
- FR-02: The system must require the user to verify their email address, through a link sent by
  email, before granting access to any financial data.
- FR-03: The system must allow a registered user to sign in with email and password.
- FR-04: The system must allow a user to reset a forgotten password through a single-use link
  sent to their verified email.
- FR-05: The system must allow a user to sign out of the current session.
- FR-06: The system must allow a user to sign out of all their sessions at once.
- FR-07: The system must reject any request for financial data that carries no valid session.
- FR-08: The system must reject any read, update or delete of financial data that the requesting
  user does not own and that is not shared with them through a group.
- FR-09: The system must set MEP as the default exchange rate type and ARS as the display
  currency of every new account.
- FR-10: The system must set the time zone of a new account to the time zone reported by the
  user's device, or to `America/Argentina/Buenos_Aires` when the device reports none.
- FR-11: The system must set the language of a new account to the device's language when it is
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
- NFR-06: Email/password sign-in and registration must each answer in < 500 ms at p95, measured
  server-side from request received to response sent. Email delivery time is not part of this
  metric.
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
- NFR-11: The web app and the API must be served under the same registrable domain (for example
  `app.argent.com` and `api.argent.com`), so that 100% of `SameSite=Strict` session cookies reach
  the API (stack decision 2026-09-26: Next.js web app and Express API as separate services).

## Acceptance Criteria
- AC-01 (FR-01): WHEN a visitor submits a valid email and a valid password on the registration
  form, THE system SHALL create an unverified account and send a verification email.
- AC-02 (FR-01): IF a visitor submits a password shorter than 10 characters or one found in the
  breached-password list, THEN THE system SHALL reject the registration and show which rule
  failed.
- AC-03 (FR-01): IF a visitor submits the registration form with an email that already has an
  account, THEN THE system SHALL show the same confirmation as AC-01 and SHALL not create a
  second account.
- AC-04 (FR-02): WHILE a user's email is unverified, THE system SHALL deny access to every
  financial data screen and endpoint and show a "verify your email" screen with a resend option.
- AC-05 (FR-02): WHEN a user opens a valid verification link, THE system SHALL mark the email as
  verified and grant access to financial data.
- AC-06 (FR-02): IF a user opens a verification link that is expired or already used, THEN THE
  system SHALL reject it and offer to send a new one.
- AC-07 (FR-03): WHEN a verified user submits a correct email and password and has no 2FA, THE
  system SHALL start a session.
- AC-08 (FR-03): IF a user submits wrong credentials, THEN THE system SHALL reject the sign-in
  with a generic "invalid email or password" message.
- AC-09 (FR-04): WHEN a user requests a password reset, THE system SHALL send a single-use reset
  link to the email if it is registered, and show the same confirmation message in either case.
- AC-10 (FR-04): WHEN a user sets a new valid password through a valid reset link, THE system
  SHALL update the password and end all of that user's existing sessions.
- AC-11 (FR-04): IF a user opens a password reset link older than 60 minutes or already used,
  THEN THE system SHALL reject it, leave the password unchanged and offer to request a new one.
- AC-12 (FR-05): WHEN a user signs out, THE system SHALL revoke the current refresh token and
  clear the session cookies.
- AC-13 (FR-06): WHEN a user chooses "sign out of all sessions", THE system SHALL revoke every
  refresh token of that user.
- AC-14 (FR-07): IF a request for financial data has no valid session, THEN THE system SHALL
  answer 401 Unauthorized.
- AC-15 (FR-08): IF an authenticated user requests to read data owned by another user and not
  shared with them through a group, THEN THE system SHALL answer 404 Not Found without revealing
  that the data exists.
- AC-16 (FR-08): IF an authenticated user requests to update or delete data owned by another
  user and not shared with them through a group, THEN THE system SHALL answer 404 Not Found and
  leave the data unchanged.
- AC-17 (FR-08): WHEN an authenticated user requests data shared with them through a group they
  belong to, THE system SHALL return that data.
- AC-18 (FR-09): WHEN a new account is created, THE system SHALL set the default exchange rate
  type to MEP and the display currency to ARS.
- AC-19 (FR-10): WHEN an account is created from a device that reports `America/Cordoba`, THE
  system SHALL set the account's time zone to `America/Cordoba`.
- AC-20 (FR-10): IF the device reports no time zone when an account is created, THEN THE system
  SHALL set the account's time zone to `America/Argentina/Buenos_Aires`.
- AC-21 (FR-11): WHEN an account is created from a device whose language is English, THE system
  SHALL set the interface language to English.
- AC-22 (FR-11): IF the device's language is neither Spanish nor English when an account is
  created, THEN THE system SHALL set the interface language to Spanish.

## Out of Scope
- Google sign-in and account linking (DISC-001-01b).
- Two-factor authentication (DISC-001-01c).
- Profile screen, editing preferences, and account deletion (DISC-001-01d); this sub-ticket only
  stores the defaults.
- Passkeys / WebAuthn, other sign-in providers, SMS or email 2FA.
- Changing the account email; invite-only registration; admin panel.
- Account recovery without access to the email.

## Risks and Mitigations
- **Open registration attracts bots** → mandatory email verification before data access, and a
  registration rate limit per IP (NFR-03).
- **Credential stuffing / brute force** → rate limiting (NFR-03), breached-password check
  (NFR-02), no account enumeration (NFR-08).
- **Verification and reset emails land in spam** → transactional email provider with SPF, DKIM
  and DMARC.
- **Foundation choices made under pressure of the first feature** → the foundation is limited to
  what `AGENTS.md` declares; any deviation is recorded as an ADR in PLAN.
- **Cookies not sent across web and API** → same registrable domain (NFR-11).

## Dependencies
- `AGENTS.md` stack: Next.js, Express 5 + Zod, PostgreSQL + Drizzle (project foundation).
- Transactional email provider (to be chosen in PLAN) — FR-02, FR-04.
- Have I Been Pwned Pwned Passwords API (k-anonymity range endpoint) — NFR-02.
- IANA time zone database — FR-10.
- Exchange rate types catalog, defined in PRD 03 (Movements & Exchange Rates) — FR-09.
- Group sharing rules, defined in PRD 05 (Groups & Expense Splitting) — FR-08.

## Decision Log
- 2026-09-26: Split from DISC-001-01 into four sub-tickets (user decision); this one first.
- 2026-09-26: Defaults (rate type, display currency, time zone, language) are set at registration
  here; editing them belongs to DISC-001-01d.
- 2026-09-26: Web and API share a registrable domain for cookies (NFR-11).
- 2026-09-26: User approved this sub-PRD and the non-functional requirements added when splitting.
