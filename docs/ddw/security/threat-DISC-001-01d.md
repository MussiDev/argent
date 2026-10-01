# Threat model DISC-001-01d: Profile, Preferences & Account Deletion

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
| `apps/api/src/identity/infrastructure/db/drizzle-profile-repository.ts` | Block 2 |
| `apps/api/src/identity/infrastructure/db/drizzle-user-deletion-repository.ts` | Block 2 |
| `apps/api/src/identity/application/update-profile.ts` | Block 3 |
| `apps/api/src/identity/infrastructure/http/profile-routes.ts` | Block 3, Block 4 |
| `apps/api/src/identity/infrastructure/security/no-two-factor-status-reader.ts` | Block 3 |
| `apps/api/src/identity/application/delete-user.ts` | Block 4 |
| `apps/web/src/features/profile/containers/profile-container.tsx` | Block 5 |
| `apps/web/src/features/profile/containers/delete-account-container.tsx` | Block 5 |

## Trust boundaries
- Browser → API: `PATCH /profile` carries a display name, an email attempt and four preferences, and `POST /profile/delete` carries the account password, over the public internet, with the session in HttpOnly cookies and the web origin plus `X-Requested-With` required by the origin guard.
- API → PostgreSQL: `drizzle-profile-repository.ts` and `drizzle-user-deletion-repository.ts` read and write `users` and trigger the `ON DELETE CASCADE` of every dependent table (`sessions`, `one_time_tokens`, `user_identities` and later modules' tables).
- Identity module → future modules and DISC-001-01c: the `TwoFactorStatusReader` port (`no-two-factor-status-reader.ts`) is the only crossing to 2FA data, and the cascade convention is the only crossing to other modules' tables.
- User-supplied text → rendered UI: the display name saved in `PATCH /profile` is shown back by `profile-container.tsx` and by later screens, so it crosses from an untrusted string into the web app's DOM.

## STRIDE analysis
### `packages/shared/src/profile/profile.ts`
- **Spoofing:** the schemas carry no identity; the user id is never part of the body (`updateProfileRequestSchema` strips a body `userId`), so a client cannot name another account.
- **Tampering:** the schema is a stripping `z.object`, so unknown keys such as `passwordHash` or `emailVerifiedAt` are dropped before any handler sees them (mass assignment); `email` is accepted only so the API can reject a different one (FR-03).
- **Repudiation:** not applicable to a pure schema; the routes that use it log the outcome (R-09).
- **Information Disclosure:** validation failures list only failing field paths, never the submitted values (shared `validate` middleware).
- **Denial of Service:** the display name has a UTF-16 cap of 200 before code points are counted, so an oversized string is rejected without iterating it; the body limit of the app (16 kb) bounds everything else.
- **Elevation of Privilege:** the response schema (`profileResponseSchema`) strips undeclared fields, so a handler cannot leak the password hash or another column.

### `packages/shared/src/profile/time-zone.ts`
- **Spoofing:** not applicable; the value identifies no actor.
- **Tampering:** a crafted time zone (`+01:00`, a 65-character string, SQL or script text) is rejected by the shape check and by `Intl`, and the stored value is the canonical `resolvedOptions().timeZone`, so later modules never receive free text (R-04).
- **Repudiation:** not applicable; the check is a pure function.
- **Information Disclosure:** the check reveals nothing beyond whether a name is in the runtime's database.
- **Denial of Service:** the length cap (64) and the anchored regular expression have no nested quantifiers, so there is no catastrophic backtracking; `Intl.DateTimeFormat` construction on a bounded string is cheap.
- **Elevation of Privilege:** not applicable; no privilege depends on the value.

### `apps/api/src/identity/infrastructure/db/drizzle-profile-repository.ts`
- **Spoofing:** the user id comes from the caller, which takes it from `auth.userId` (the live session row), never from the request.
- **Tampering:** `update` writes only the five whitelisted columns in one statement (all or nothing) with bound parameters; the `users_display_name_check` constraint (1 to 50 characters) and the existing preference checks are the last line of defense (R-04).
- **Repudiation:** the use case logs the changed field names with user id, request id and IP.
- **Information Disclosure:** `findByUserId` exposes `hasPassword` as a boolean and never the hash; every query is scoped by the user id, so no query can return another user's row.
- **Denial of Service:** primary-key queries, no scan, no new index needed.
- **Elevation of Privilege:** the repository has no method that writes `email`, `password_hash`, `credentials_version` or `email_verified_at`, so no caller can change them through it.

### `apps/api/src/identity/infrastructure/db/drizzle-user-deletion-repository.ts`
- **Spoofing:** the delete takes the user id and the credentials version the caller read; a stale version deletes nothing (R-13).
- **Tampering:** one transaction: `DELETE FROM users WHERE id = $1 AND credentials_version = $2` (the foreign keys cascade inside that statement) followed by the removal of the user's `email_outbox` rows, so no partial deletion is visible (R-10, R-11).
- **Repudiation:** the route logs the deletion with user id, session id, IP and request id (R-09).
- **Information Disclosure:** the repository returns only a boolean; the address it reads back from the deleted row is used only to remove that user's outbox rows and is never returned or logged.
- **Denial of Service:** the cascade and the outbox cleanup touch only the user's own rows (the outbox match is by `payload->>'userId'` and by address, a small table purged after 7 days); there is no unbounded loop in application code.
- **Elevation of Privilege:** the method is reachable only through `DeleteUser`, after a password check; no other route calls it.

### `apps/api/src/identity/application/update-profile.ts`
- **Spoofing:** acts on the id from `requireSession`; a body `userId` is stripped by the schema.
- **Tampering:** compares a submitted `email` with the account's after `Email.parse` and raises `EmailChangeNotAllowed` (400) before anything is written (R-04); other fields are validated before the single write.
- **Repudiation:** one `info` log line per outcome with the names of the changed fields, never their values.
- **Information Disclosure:** returns only the caller's own profile; errors carry codes, not data.
- **Denial of Service:** one write per request, no hashing; the p95 target of NFR-01 is benchmarked.
- **Elevation of Privilege:** it cannot change the email, the password or the verification state, so a stolen session cannot take over the account through the profile (R-04).

### `apps/api/src/identity/infrastructure/http/profile-routes.ts`
- **Spoofing:** `requireSession` authenticates every request against the live session row (a revoked session stops working at once); `GET /profile`, `PATCH /profile` and `POST /profile/delete` all mount it first.
- **Tampering:** the shared `validate` middleware parses body and strips unknown keys; the origin guard rejects state-changing requests without the web origin and `X-Requested-With` (R-05), and cookies are `SameSite=Strict`.
- **Repudiation:** every outcome is logged with request id, IP, user id and session id; the deletion log survives the deletion and contains no email (R-09).
- **Information Disclosure:** profile responses carry `Cache-Control: no-store` (R-07); error bodies carry only a code and field paths; logs never include the display name, email, password or preference values (R-06).
- **Denial of Service:** the JSON body limit (16 kb) applies; deletion's Argon2id work is gated by the sign-in limits before it runs (R-02, R-03).
- **Elevation of Privilege:** the routes take the user id only from `auth`, so no horizontal escalation by id (R-01); `requireVerifiedEmail` is deliberately not mounted so an unverified user can still read and delete their own data, which grants nothing over anyone else's.

### `apps/api/src/identity/infrastructure/security/no-two-factor-status-reader.ts`
- **Spoofing:** not applicable; it takes no credentials.
- **Tampering:** if it stays wired after DISC-001-01c merges, the profile reports `twoFactorEnabled: false` for a user who has 2FA on, a wrong security signal (R-08).
- **Repudiation:** not applicable; it records nothing.
- **Information Disclosure:** it returns a constant, so it discloses nothing.
- **Denial of Service:** no I/O, nothing to exhaust.
- **Elevation of Privilege:** nothing is authorized by the status; but deletion relies on password only until decision D-1 is answered (R-14).

### `apps/api/src/identity/application/delete-user.ts`
- **Spoofing:** an attacker with a stolen session still needs the account password; the check is `PasswordHasher.verify`, with a dummy hash for password-less accounts so both paths cost the same (R-01, R-12).
- **Tampering:** the delete is conditional on the credentials version read before the check, so a password reset between check and delete aborts it (R-13).
- **Repudiation:** the use case result is logged by the route with user id, session id, IP and request id; failed attempts are counted in `auth_attempts` (R-09).
- **Information Disclosure:** a wrong password and an account without a password give the same 401 `INVALID_CREDENTIALS`, so the endpoint reveals nothing about the account that the owner's own session does not already know.
- **Denial of Service:** units in `SIGN_IN_ACCOUNT_POLICY` and `SIGN_IN_IP_POLICY` are reserved before any Argon2id work, so parallel requests share at most the limit (R-02); the same counters mean an attacker holding a session can lock the owner's sign-in for the 15-minute window (R-03).
- **Elevation of Privilege:** deletion is the most destructive action of the account; it requires the password re-entry and nothing weaker, and the second factor gap is tracked as R-14.

### `apps/web/src/features/profile/containers/profile-container.tsx`
- **Spoofing:** the container sends no identity; the session cookie is HttpOnly and travels through `credentials: 'include'` only.
- **Tampering:** it sends only the changed fields and the email is never an input; the API remains the authority on every value.
- **Repudiation:** not applicable on the client; the API logs the outcome.
- **Information Disclosure:** the profile is fetched client-side from the API (no Server Component touches personal data) and with `cache: 'no-store'`; nothing is written to local storage.
- **Denial of Service:** one request per save; a failed request keeps the form state and can be resubmitted.
- **Elevation of Privilege:** it renders the display name as React text (escaped), never as HTML, and the page runs under the nonce-based CSP (R-06).

### `apps/web/src/features/profile/containers/delete-account-container.tsx`
- **Spoofing:** the password field is `type=password` with `autocomplete=current-password`; the password goes only to the API over TLS, in the JSON body of `POST /profile/delete`.
- **Tampering:** the request needs the web origin and `X-Requested-With`, which a cross-site form cannot send (R-05).
- **Repudiation:** the user sees an explicit warning before submitting; the API logs the deletion.
- **Information Disclosure:** the password is not kept in state after submit, not logged and not put in a URL.
- **Denial of Service:** the submit button is disabled while a request is pending, so a double click sends one request; a second one would answer 401 after the account is gone.
- **Elevation of Privilege:** on 204 the client navigates to sign-in; it holds no token to reuse because tokens are HttpOnly cookies the API clears.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| account password (delete request) | credentials | never stored by this ticket; verified against the existing Argon2id hash in `users.password_hash`; database volume encrypted with AES-256 | TLS 1.2+; JSON body only, never a URL or log |
| password hash (`users.password_hash`) | credentials | Argon2id; never returned by `ProfileRepository` or any response; database volume encrypted with AES-256 | not transmitted |
| session cookies | credentials | refresh token stored as a SHA-256 hash in `sessions`; removed by the deletion cascade; database volume encrypted with AES-256 | TLS 1.2+; `HttpOnly` `Secure` `SameSite=Strict` cookies |
| email address | PII | `users.email`; database volume encrypted with AES-256; never logged; read-only in the profile | TLS 1.2+; `Cache-Control: no-store` |
| display name (`users.display_name`) | PII | `users` column with a 1 to 50 character check; database volume encrypted with AES-256; never logged | TLS 1.2+; `Cache-Control: no-store` |
| default rate type, display currency, time zone, language | PII | `users` columns with check constraints (time zone canonicalized before storing); database volume encrypted with AES-256 | TLS 1.2+; `Cache-Control: no-store` |
| 2FA status (`twoFactorEnabled`) | PII | derived through the `TwoFactorStatusReader` port; not stored by this ticket | TLS 1.2+; `Cache-Control: no-store` |
| deletion audit log (user id, session id, IP, request id) | PII | application logs, without email or password; retention is the platform's log retention | TLS 1.2+ to the log platform |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A stolen session cookie is used to delete the account, or to read or change another user's profile by id | S | M | H | `POST /profile/delete` re-verifies the password (Block 4); the user id of every route comes from `auth.userId`, a body `userId` is stripped, and a test proves another user's profile cannot be read or changed (Block 3) |
| R-02 | Password guessing through `POST /profile/delete` bypasses the sign-in limits | S | M | H | the use case reserves one unit in `SIGN_IN_ACCOUNT_POLICY` and `SIGN_IN_IP_POLICY` before hashing and keeps it on failure, so parallel guesses share the same limit as sign-in (AC-11, Block 4); a 6th wrong attempt answers 429 |
| R-03 | An attacker holding a session spends the owner's sign-in limit through failed deletions and locks them out for 15 minutes | D | L | M | the PRD requires failed re-authentication to count as a failed sign-in (AC-11); the damage is bounded by the 15-minute window, and the attacker already holds a live session; the owner's other live sessions can still use `sign-out-all` (documented in Block 4) |
| R-04 | Mass assignment or email takeover through `PATCH /profile` (body with `email`, `passwordHash`, `emailVerifiedAt`) or a crafted time zone | T | M | H | the stripping schema drops unknown keys; `EmailChangeNotAllowed` rejects a different email with 400 before any write; the repository writes only five whitelisted columns; the time zone is shape-checked, verified by `Intl` and canonicalized (Blocks 1 to 3, tests for AC-04 and AC-08) |
| R-05 | Cross-site request forgery of `PATCH /profile` or `POST /profile/delete` | T | L | H | `SameSite=Strict` cookies plus the origin guard (web origin and `X-Requested-With: argent`) already applied to every non-safe method; tested for `PATCH /profile` (Block 3) |
| R-06 | Stored script injection through the display name, or personal data in logs | I | M | H | the display name is rendered as escaped React text under the nonce-based CSP, limited to 50 code points, never put in HTML, emails or logs; log lines carry only field names; a test asserts it (Blocks 3 and 5) |
| R-07 | Profile data cached by a browser or proxy and shown to another user | I | L | M | `Cache-Control: no-store` on `GET /profile` and `PATCH /profile` responses (Block 3), and the web client fetches with `cache: 'no-store'` |
| R-08 | The profile shows 2FA as off for a user who has it on, because the stub adapter stays wired after DISC-001-01c merges | T | M | M | the stub logs a `warn` at construction so a deployment that kept it is visible; open decision D-5 recommends merging 01c first, or assigns the swap to the second of the two branches to merge, which must add a test where a user who enabled 2FA sees `twoFactorEnabled: true`; this ticket's tests use a fake reader returning true, so the port contract is covered |
| R-09 | A deletion or profile change is denied afterwards, with no audit trail (and the user's rows are gone) | R | L | M | one `info` log per outcome with request id, IP, user id, session id (never email or password), kept in the application logs after the rows are deleted; failed re-authentications also leave a counter row in `auth_attempts` |
| R-10 | Personal data is left behind after deletion, because a later module's table has no cascading foreign key | T | M | H | one transaction with `ON DELETE CASCADE` foreign keys; `user-erasure.test.ts` discovers every foreign key referencing `users`, fails if its table is not registered with a seeder and a deletion policy (or a `cascade` entry does not cascade), and counts 0 rows per registered table (NFR-02); group-shared records are PRD 05's decision and register their own policy |
| R-11 | Residual personal data after deletion in `email_outbox` (recipient address of a pending email) and `auth_attempts` (email-keyed counters) | I | L | L | the deletion transaction removes the user's `email_outbox` rows by user id and by address, so no pending email is sent to a deleted address (tested in Blocks 2 and 4); `auth_attempts` counters are purged by the email worker after 24 hours (existing retention) |
| R-12 | CPU exhaustion through Argon2id work in `POST /profile/delete` | D | M | M | units are reserved before any hashing and a refused request is answered 429 without hashing; the body limit applies; a password-less account verifies a dummy hash so timing is uniform |
| R-13 | A password reset or another credential change lands between the password check and the delete, so the account is deleted on stale credentials | T | L | M | the delete is conditional on `credentials_version` read before the check; a race test shows a 401 and the account kept (Block 4) |
| R-14 | An account with 2FA enabled is deleted with only the password, bypassing the second factor (open decision D-1) | E | L | H | on main no account can have 2FA, so the gap cannot occur in this ticket's deliverable; decision D-1 must be answered before DISC-001-01c and this ticket are both on main, and the branch that merges second must add the second-factor step to `DeleteUser` (the spec lists it as an open decision, and the report asks the owner); compensating controls meanwhile are the password re-entry, the shared sign-in limits and the logged audit trail |
| R-15 | Accounts created through Google (no password) cannot re-authenticate, so their owners cannot delete their data until they set a password (open decision D-2) | E | M | L | the profile exposes `hasPassword` and the delete screen tells the user to set a password through the existing password reset; the API answers the same 401 as a wrong password with the same limits, so nothing is deleted without a verified credential |

## Supply chain
No new runtime or development dependency is added (spec: "Justified new dependencies: None"). The time zone check uses the runtime's `Intl`, the amount formatter is plain `bigint` arithmetic in `packages/shared`, and the select control is a native element, so the existing `pnpm audit --prod --audit-level high` gate covers the dependency surface unchanged.

## Availability
The only expensive path is Argon2id in `POST /profile/delete`, gated by the reserve-before-hash sign-in limits (R-02, R-12), so an attacker cannot multiply hashing work; the 429 answer costs no hashing. `PATCH /profile` and `GET /profile` are single primary-key statements (NFR-01 benchmark under 300 ms p95). The deletion cascade is bounded by the user's own rows, and one account's deletion does not lock other accounts' rows. The API is stateless, so any instance can serve any request.
