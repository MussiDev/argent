# Threat model DISC-001-01d: Profile & Preferences

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01d |
| Spec | docs/ddw/specs/spec-DISC-001-01d.md |
| Tier | FEATURE |
| Date | 2026-10-01 |

## Components
| Component | Source in the spec |
|---|---|
| `packages/shared/src/profile/profile.ts` | Block 1 |
| `packages/shared/src/profile/time-zone.ts` | Block 1 |
| `packages/shared/src/money/format-minor-units.ts` | Block 1 |
| `apps/api/src/identity/infrastructure/db/drizzle-profile-repository.ts` | Block 2 |
| `apps/api/src/identity/application/update-profile.ts` | Block 3 |
| `apps/api/src/identity/application/get-profile.ts` | Block 3 |
| `apps/api/src/identity/infrastructure/http/profile-routes.ts` | Block 3 |
| `apps/web/src/features/profile/containers/profile-container.tsx` | Block 4 |

## Trust boundaries
- Browser → API: `PATCH /profile` carries a display name, an email attempt and four preferences, and `GET /profile` returns the same data, over the public internet, with the session in HttpOnly cookies and the web origin plus `X-Requested-With` required by the origin guard on `PATCH`.
- API → PostgreSQL: `drizzle-profile-repository.ts` reads and writes the profile columns of `users`, by primary key.
- Identity module → DISC-001-01c: `get-profile.ts` calls `GetTwoFactorStatus`, which reads `user_two_factor` and `recovery_codes`; only the boolean `enabled` crosses into the profile response.
- User-supplied text → rendered UI: the display name saved in `PATCH /profile` is shown back by `profile-container.tsx` and by later screens, so it crosses from an untrusted string into the web app's DOM.
- User-supplied text → later modules: the saved time zone and preferences are read by every later module (the schema `users` columns), so they cross from user input into code that formats dates and amounts.

## STRIDE analysis
### `packages/shared/src/profile/profile.ts`
- **Spoofing:** the schemas carry no identity; the user id is never part of the body (`updateProfileRequestSchema` strips a body `userId`), so a client cannot name another account.
- **Tampering:** the schema is a stripping `z.object`, so unknown keys such as `passwordHash` or `emailVerifiedAt` are dropped before any handler sees them (mass assignment); `email` is accepted only so the API can reject a different one (FR-03) (R-03).
- **Repudiation:** not applicable to a pure schema; the routes that use it log the outcome (R-08).
- **Information Disclosure:** validation failures list only failing field paths, never the submitted values (shared `validate` middleware); `profileResponseSchema` strips undeclared fields, so a handler cannot leak the password hash or another column.
- **Denial of Service:** the display name has a UTF-16 cap of 200 before code points are counted, so an oversized string is rejected without iterating it; the 16 kb body limit of the app bounds everything else.
- **Elevation of Privilege:** `profileResponseSchema` has no field for credentials, and `updateProfileRequestSchema` has none that grants a role, so the schemas give no path to higher privilege.

### `packages/shared/src/profile/time-zone.ts`
- **Spoofing:** not applicable; the value identifies no actor.
- **Tampering:** a crafted time zone (`+01:00`, a 65-character string, SQL or script text) is rejected by the shape check and by `Intl`, and the stored value is the canonical `resolvedOptions().timeZone`, so later modules never receive free text (R-04).
- **Repudiation:** not applicable; the check is a pure function.
- **Information Disclosure:** the check reveals nothing beyond whether a name is in the runtime's database.
- **Denial of Service:** the length cap (64) and the anchored regular expression have no nested quantifiers, so there is no catastrophic backtracking; constructing `Intl.DateTimeFormat` for a bounded string is cheap.
- **Elevation of Privilege:** not applicable; no privilege depends on the value.

### `packages/shared/src/money/format-minor-units.ts`
- **Spoofing:** not applicable; it is a pure function of an amount and a language.
- **Tampering:** it works on `bigint` with integer division and remainder, never a float, so a large amount cannot be silently rounded or altered while formatting (R-10).
- **Repudiation:** not applicable; it records nothing.
- **Information Disclosure:** it returns only the string for the amount it is given.
- **Denial of Service:** the cost is linear in the number of digits of the `bigint`, and callers pass stored amounts, not user-controlled sizes.
- **Elevation of Privilege:** not applicable; it grants nothing.

### `apps/api/src/identity/infrastructure/db/drizzle-profile-repository.ts`
- **Spoofing:** the user id comes from the caller, which takes it from `auth.userId` (the live session row), never from the request.
- **Tampering:** `update` writes only the five whitelisted columns in one statement (all or nothing) with bound parameters; the `users_display_name_check` constraint (1 to 50 characters) and the existing preference checks are the last line of defense (R-03).
- **Repudiation:** the use case logs the changed field names with user id, request id and IP.
- **Information Disclosure:** `findByUserId` never returns the password hash; every query is scoped by the user id, so no query can return another user's row (R-01).
- **Denial of Service:** primary-key queries, no scan, no new index needed.
- **Elevation of Privilege:** the repository has no method that writes `email`, `password_hash`, `credentials_version` or `email_verified_at`, so no caller can change them through it.

### `apps/api/src/identity/application/update-profile.ts`
- **Spoofing:** acts on the id from `requireSession`; a body `userId` is stripped by the schema (R-01).
- **Tampering:** compares a submitted `email` with the account's after `Email.parse` and raises `EmailChangeNotAllowed` (400) before anything is written (R-03); other fields are validated before the single write.
- **Repudiation:** one `info` log line per outcome with the names of the changed fields, never their values (R-08).
- **Information Disclosure:** returns only the caller's own profile; errors carry codes, not data.
- **Denial of Service:** one write per request, no hashing; the p95 target of NFR-01 is benchmarked (R-09).
- **Elevation of Privilege:** it cannot change the email, the password or the verification state, so a stolen session cannot take over the account through the profile (R-03).

### `apps/api/src/identity/application/get-profile.ts`
- **Spoofing:** reads the profile of the id it is given, which comes from the session.
- **Tampering:** read-only; it writes nothing.
- **Repudiation:** the route logs the outcome with request id, IP and user id.
- **Information Disclosure:** the 2FA status crosses from 01c as a boolean only; no secret, sealed value or recovery code count is placed in the profile response (R-07).
- **Denial of Service:** one or two primary-key reads per request.
- **Elevation of Privilege:** a failed 2FA lookup answers 500 instead of a profile that claims 2FA is off, so the screen never shows a false "not enabled".

### `apps/api/src/identity/infrastructure/http/profile-routes.ts`
- **Spoofing:** `requireSession` authenticates every request against the live session row (a revoked session stops working at once); both routes mount it first (R-01).
- **Tampering:** the shared `validate` middleware parses the body and strips unknown keys; the origin guard rejects `PATCH` without the web origin and `X-Requested-With`, and cookies are `SameSite=Strict` (R-05).
- **Repudiation:** every outcome is logged with request id, IP and user id (R-08).
- **Information Disclosure:** profile responses carry `Cache-Control: no-store` (R-06); error bodies carry only a code and field paths; logs never include the display name, email or preference values (R-08).
- **Denial of Service:** the JSON body limit (16 kb) applies and each request does one primary-key statement (R-09).
- **Elevation of Privilege:** the routes take the user id only from `auth`, so there is no horizontal escalation by id (R-01); `requireVerifiedEmail` is deliberately not mounted, which grants nothing over anyone else's data.

### `apps/web/src/features/profile/containers/profile-container.tsx`
- **Spoofing:** the container sends no identity; the session cookie is HttpOnly and travels through `credentials: 'include'` only.
- **Tampering:** it sends only the changed fields and the email is never an input; the API remains the authority on every value.
- **Repudiation:** not applicable on the client; the API logs the outcome.
- **Information Disclosure:** the profile is fetched client-side from the API (no Server Component touches personal data) with `cache: 'no-store'`; nothing is written to local storage.
- **Denial of Service:** one request per save; a failed request keeps the form state and can be resubmitted.
- **Elevation of Privilege:** it renders the display name as React text (escaped), never as HTML, and the page runs under the nonce-based CSP (R-02).

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| email address | PII | `users.email`; database volume encrypted with AES-256; never logged; read-only in the profile | TLS 1.2+; `Cache-Control: no-store` |
| display name (`users.display_name`) | PII | `users` column with a 1 to 50 character check; database volume encrypted with AES-256; never logged | TLS 1.2+; `Cache-Control: no-store` |
| default rate type, display currency, time zone, language | PII | `users` columns with check constraints (time zone canonicalized before storing); database volume encrypted with AES-256 | TLS 1.2+; `Cache-Control: no-store` |
| 2FA status (`twoFactorEnabled`) | PII | derived from `user_two_factor` through `GetTwoFactorStatus`; not stored by this ticket; the TOTP secret stays sealed with AES-256-GCM by 01c and never reaches this code | TLS 1.2+; `Cache-Control: no-store` |
| session cookies | credentials | refresh token stored as a SHA-256 hash in `sessions`; not read or written by this ticket; database volume encrypted with AES-256 | TLS 1.2+; `HttpOnly` `Secure` `SameSite=Strict` cookies |
| password hash (`users.password_hash`) | credentials | Argon2id; never selected by `ProfileRepository` and never returned by any profile response; database volume encrypted with AES-256 | not transmitted |
| profile audit log (user id, request id, IP, changed field names) | PII | application logs, without email, display name or preference values; retention is the platform's log retention | TLS 1.2+ to the log platform |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A stolen or foreign session reads or changes another user's profile by naming another id | S | M | H | the user id of both routes comes only from `auth.userId`, a body `userId` is stripped by the schema, every repository query is scoped by it, and a test proves another user's profile cannot be read or changed (Block 3) |
| R-02 | Stored script injection through the display name | I | M | H | the display name is limited to 50 code points, rendered as escaped React text under the nonce-based CSP, and never put in HTML, emails or logs (Blocks 3 and 4, tests for AC-02 and the log test) |
| R-03 | Mass assignment or email takeover through `PATCH /profile` (a body with `email`, `passwordHash` or `emailVerifiedAt`) | T | M | H | the stripping schema drops unknown keys; `EmailChangeNotAllowed` rejects a different email with 400 before any write; the repository writes only five whitelisted columns (Blocks 1 to 3, test for AC-04) |
| R-04 | A crafted time zone or preference reaches later modules that format dates and amounts | T | M | M | the time zone is shape-checked, verified by `Intl` and canonicalized; enums are checked by the schema and by database check constraints (Blocks 1 and 2, tests for AC-07 and AC-08) |
| R-05 | Cross-site request forgery of `PATCH /profile` | T | L | M | `SameSite=Strict` cookies plus the origin guard (web origin and `X-Requested-With: argent`) already applied to every non-safe method; tested for `PATCH /profile` (Block 3) |
| R-06 | Profile data cached by a browser or proxy and shown to another user | I | L | M | `Cache-Control: no-store` on `GET /profile` and `PATCH /profile` responses (Block 3), and the web client fetches with `cache: 'no-store'` |
| R-07 | The profile shows a wrong 2FA status, or leaks 2FA material | I | L | M | `get-profile.ts` reads the status only through 01c's `GetTwoFactorStatus` and exposes a boolean; a failed lookup answers 500 instead of "off"; the response schema has no field for secrets or recovery codes; a test enables 2FA through 01c's flow and expects `twoFactorEnabled: true` (Block 3) |
| R-08 | A profile change is denied afterwards, or personal data lands in logs | R | L | M | one `info` log per outcome with request id, IP, user id and changed field names, never the display name, email or preference values, asserted by a test (Block 3) |
| R-09 | Request flooding of the profile routes degrades the service | D | M | L | each request is one primary-key statement with no hashing, the 16 kb body limit applies, the API is stateless so instances scale out, and the p95 < 300 ms benchmark guards the cost (NFR-01, Block 3) |
| R-10 | An amount is altered by rounding when formatted | T | L | M | the formatter works on `bigint` with integer arithmetic only, never a float, and its unit tests include amounts above 2^53 (Block 1, test for AC-10) |

## Supply chain
No new runtime or development dependency is added (spec: "Justified new dependencies: None"). The time zone check uses the runtime's `Intl`, the amount formatter is plain `bigint` arithmetic in `packages/shared`, and the select control is a native element, so the existing `pnpm audit --prod --audit-level high` gate covers the dependency surface unchanged.

## Availability
`PATCH /profile` and `GET /profile` are single primary-key statements (NFR-01 benchmark under 300 ms p95) with no password hashing, so there is no expensive path for an attacker to multiply; the JSON body limit of 16 kb bounds request size and the API is stateless, so any instance can serve any request. The only extra read is 01c's 2FA status lookup, also by primary key.
