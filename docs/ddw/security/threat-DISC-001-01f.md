# Threat model DISC-001-01f: Account Deletion

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01f |
| Spec | docs/ddw/specs/spec-DISC-001-01f.md |
| Tier | FEATURE |
| Date | 2026-10-02 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/identity/application/delete-user.ts` | Block 3, Block 4 |
| `apps/api/src/identity/infrastructure/db/drizzle-user-deletion-repository.ts` | Block 2 |
| `apps/api/src/identity/infrastructure/db/drizzle-deletion-grant-repository.ts` | Block 2 |
| `apps/api/src/identity/infrastructure/db/drizzle-oauth-state-repository.ts` | Block 2 |
| `apps/api/src/identity/application/start-deletion-reauth.ts` | Block 4 |
| `apps/api/src/identity/application/complete-deletion-reauth.ts` | Block 4 |
| `apps/api/src/identity/application/complete-google-sign-in.ts` | Block 4 |
| `apps/api/src/identity/infrastructure/security/google-oidc-identity-provider.ts` | Block 4 |
| `apps/api/src/identity/infrastructure/http/profile-routes.ts` | Block 3, Block 4 |
| `apps/api/src/identity/infrastructure/http/google-routes.ts` | Block 4 |
| `apps/web/src/features/profile/containers/delete-user-container.tsx` | Block 5 |

## Trust boundaries
- Browser → API: `POST /profile/delete` carries the password and a second-factor code (and, for a password-less account, the grant cookie) over the public internet, with the session in HttpOnly cookies and the web origin plus `X-Requested-With` required by the origin guard; `POST /profile/delete/google/start` starts the re-authentication under the same rules.
- Google → browser → API: the callback `GET /auth/google/callback` arrives by a cross-site top-level navigation from Google, so it carries no `Strict` session cookie; only the single-use state, the Lax binding cookie and the ID token authenticate it.
- API → PostgreSQL: `drizzle-user-deletion-repository.ts` deletes the `users` row and triggers the `ON DELETE CASCADE` of every dependent table (accounts, sessions, identities, 2FA, challenges, OAuth states, grants) and removes the `email_outbox` rows; `drizzle-deletion-grant-repository.ts` stores and consumes the grants.
- Identity module → other modules' data: the foreign-key graph from `users` (today `accounts` of DISC-001-02a; later DISC-001-02b `categories`, DISC-001-07a and the movements of PRD 03) is the only crossing; the erasure guard test is its control.
- Identity module → DISC-001-01c: `delete-user.ts` calls the second-factor check and limits of 01c, and the secret box that opens the TOTP secret.

## STRIDE analysis
### `apps/api/src/identity/application/delete-user.ts`
- **Spoofing:** an attacker with a stolen session still needs the password (checked with `PasswordHasher.verify` under the sign-in limits), or for a password-less account a grant that only the legitimate Google re-authentication of that same session can create; with 2FA on the second factor is required on every path (R-01, R-03).
- **Tampering:** the grant is consumed and the user deleted in one unit of work, and the delete is conditional on the credentials version read before the checks, so a password reset between check and delete aborts it (R-07).
- **Repudiation:** the route logs user id, session id, IP and request id for every outcome, and the log outlives the rows and the logger redacts the password, codes, grant and authorization URL; failed passwords and codes also leave counters in `auth_attempts` (R-08).
- **Information Disclosure:** a wrong password, a missing password and a missing hash answer the same 401, a missing or wrong second factor answers 400 without revealing which part failed beyond what the signed-in owner already knows; nothing is logged but ids (R-08).
- **Denial of Service:** the limits are reserved before any Argon2id or TOTP work, so parallel requests share the limit and an over-limit request costs no hashing; an attacker holding a session can burn the owner's sign-in budget for 15 minutes, which the PRD's AC-02 requires (R-04).
- **Elevation of Privilege:** deletion is the most destructive action; it demands the strongest re-authentication the account has, and a user with a password cannot use the weaker Google path (AC-10) (R-02).

### `apps/api/src/identity/infrastructure/db/drizzle-user-deletion-repository.ts`
- **Spoofing:** it takes the user id and credentials version the use case read; a stale version deletes nothing.
- **Tampering:** one transaction removes the `users` row (the foreign keys cascade inside that statement) and the user's outbox rows, so no partial erasure is visible (R-06).
- **Repudiation:** the use case and the route log the outcome; the repository returns only a boolean.
- **Information Disclosure:** the address read back from the deleted row is used only to delete outbox rows and is never returned or logged.
- **Denial of Service:** it touches only the user's own rows (indexed by `user_id`; the outbox match is by a small, purged table) with no unbounded loop in application code.
- **Elevation of Privilege:** it is reachable only through `DeleteUser`, after the re-authentication; no other code deletes users.

### `apps/api/src/identity/infrastructure/db/drizzle-deletion-grant-repository.ts`
- **Spoofing:** a grant is found only by the hash of a 256-bit token together with the user id, session family and credentials version, so a token alone, or a token from another session, proves nothing (R-03).
- **Tampering:** consumption is one conditional `DELETE … RETURNING`, so a grant is used at most once even under parallel requests; issuing a new grant replaces the user's previous one.
- **Repudiation:** grant issue and use are logged by the callback and the deletion route with user and session ids, never the token.
- **Information Disclosure:** only the SHA-256 hash is stored, so a database leak yields no usable grant.
- **Denial of Service:** one row per user, purged by the worker after expiry; lookups are by primary key.
- **Elevation of Privilege:** a grant authorizes only deletion of its own user, in its own session, once, within 5 minutes.

### `apps/api/src/identity/infrastructure/db/drizzle-oauth-state-repository.ts`
- **Spoofing:** a `delete_account` state stores the user and the session family it was started for, and consumption still requires the binding cookie's hash, so only the browser that started the flow completes it (R-05).
- **Tampering:** the state is consumed by one `DELETE … RETURNING`, single use as before; database checks force a `delete_account` row to carry both a user and a session family and a `sign_in` row to carry neither.
- **Repudiation:** the start logs the user and session ids.
- **Information Disclosure:** the PKCE verifier stays in plaintext for at most 10 minutes as in DISC-001-01b, hashes for state, binding and nonce.
- **Denial of Service:** the existing per-IP start limit and the expiry purge bound the rows.
- **Elevation of Privilege:** the purpose column selects the branch, so a sign-in state can never mint a grant (R-05).

### `apps/api/src/identity/application/start-deletion-reauth.ts`
- **Spoofing:** it needs a valid session (`requireSession`) and acts on the session's user and session id only; a user with a password is refused so the weaker path cannot be chosen (A-5).
- **Tampering:** state, binding, nonce and verifier come from the token generator (256 random bits each); the user and session are taken from `auth`, never from the request.
- **Repudiation:** the start logs user id, session id, IP and request id.
- **Information Disclosure:** the response carries only the authorization URL for that state, with `Cache-Control: no-store`; no email is placed in the URL (no `login_hint`).
- **Denial of Service:** one unit of `google_start_ip` per call before any row is written.
- **Elevation of Privilege:** starting grants nothing: the grant exists only after Google confirms the linked identity.

### `apps/api/src/identity/application/complete-deletion-reauth.ts`
- **Spoofing:** it requires that the verified Google `sub` is linked to exactly the state's user, that `auth_time`, when sent, is not older than the state, and that the starting session family is still live; any mismatch ends in the same refusal without a grant (R-05, R-09).
- **Tampering:** the grant is created only here, after those checks, with a hashed token, the user's current credentials version and a 5-minute expiry.
- **Repudiation:** every outcome is logged with the user id and a reason, never the claims.
- **Information Disclosure:** every refusal after the state was consumed as a `delete_account` state answers the same redirect, so the callback reveals nothing about which check failed.
- **Denial of Service:** one grant row per user; no extra network call beyond the existing token exchange.
- **Elevation of Privilege:** a Google account that is not the linked one cannot obtain a grant for someone else's user (R-05).

### `apps/api/src/identity/application/complete-google-sign-in.ts`
- **Spoofing:** the state's purpose, read from the consumed row, decides the branch; a `delete_account` state never resolves, links or creates an account (R-05).
- **Tampering:** the sign-in branch is unchanged; the added branch cannot write users, identities or sessions.
- **Repudiation:** the callback logs the path and the failure reason as before.
- **Information Disclosure:** the new refusal reasons are logged only; the browser always gets the same redirect (R-05).
- **Denial of Service:** no extra work for sign-in; the deletion branch adds two primary-key reads.
- **Elevation of Privilege:** the shared callback is the one place where state, nonce, PKCE and ID-token checks live, so the re-authentication cannot be weaker than a sign-in (NFR-04).

### `apps/api/src/identity/infrastructure/security/google-oidc-identity-provider.ts`
- **Spoofing:** `prompt=login` and `max_age=0` ask Google to authenticate the user again, and `auth_time` (when present) proves it happened after the request; if Google omits the claim the control falls back to `prompt=login` and the state's age (R-09).
- **Tampering:** the ID token is verified as before (signature, audience, issuer, expiry, nonce); the new claim is optional and parsed apart from the strict ones.
- **Repudiation:** failures keep carrying a reason and never the claims.
- **Information Disclosure:** the adapter never logs claims or tokens.
- **Denial of Service:** unchanged timeouts on the token and key requests.
- **Elevation of Privilege:** the reauthenticate flag only changes the authorization request; it cannot relax any verification.

### `apps/api/src/identity/infrastructure/http/profile-routes.ts`
- **Spoofing:** both new routes mount `requireSession` first and read the user and session ids only from `auth`.
- **Tampering:** `validate` parses and strips the body; the origin guard requires the web origin and `X-Requested-With`, and the session cookies are `SameSite=Strict` (R-10).
- **Repudiation:** every outcome is logged with ids, never the password, a code or the grant.
- **Information Disclosure:** responses carry `Cache-Control: no-store`; error bodies carry codes only.
- **Denial of Service:** the 16 kb body limit applies, the limits are reserved before expensive work, and the start route has its own per-IP limit.
- **Elevation of Privilege:** `requireVerifiedEmail` is deliberately not mounted, so an unverified user can delete their own data, which grants nothing over anyone else's.

### `apps/api/src/identity/infrastructure/http/google-routes.ts`
- **Spoofing:** the callback authenticates by state, binding cookie and ID token; the grant cookie is set only after `CompleteDeletionReauth` issued the grant.
- **Tampering:** the grant cookie is `__Secure-` prefixed, `HttpOnly`, `Secure`, `SameSite=Strict`, scoped to `/profile/delete` and lives 5 minutes; the redirect carries only a flag and never a token (R-03).
- **Repudiation:** the callback logs the outcome with the user id and reason.
- **Information Disclosure:** the redirect URL is built from `WEB_BASE_URL` and a stored language, never from a query value; failures all look the same to the browser.
- **Denial of Service:** unchanged: one redirect per callback, the binding cookie is cleared first.
- **Elevation of Privilege:** the cookie alone cannot delete anything: the deletion route also needs the session, the matching grant row and (with 2FA) the second factor.

### `apps/web/src/features/profile/containers/delete-user-container.tsx`
- **Spoofing:** the container sends no identity; the session and the grant travel in HttpOnly cookies the script cannot read.
- **Tampering:** it validates the input shape with the shared schema and the API stays the authority; the `reauth` flag in the URL only chooses which form to show and grants nothing.
- **Repudiation:** the user sees an explicit permanent-deletion warning before the destructive button; the API logs the outcome.
- **Information Disclosure:** the password and the code are cleared after submit, not stored, not logged and not put in a URL.
- **Denial of Service:** the submit button is disabled while a request is pending; a second request would answer 401 after the account is gone.
- **Elevation of Privilege:** no token or secret is held in the page; `window.location.assign` goes only to the authorization URL the API returned.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| account password (delete request) | credentials | never stored by this ticket; verified against the existing Argon2id hash; database volume encrypted with AES-256 | TLS 1.2+; JSON body only, never a URL or log |
| second-factor code (delete request) | credentials | never stored; a spent TOTP step or recovery code is recorded as in DISC-001-01c (the recovery codes only as Argon2id hashes); database volume encrypted with AES-256 | TLS 1.2+; JSON body only |
| deletion grant token | credentials | only its SHA-256 hash in `deletion_grants`, with user, session, credentials version and a 5-minute expiry; deleted on use, on replacement, with the user and by the purge (a grant of a revoked session family stays at most 5 minutes and cannot be used because the deletion needs a live session of that family); database volume encrypted with AES-256 | TLS 1.2+; `HttpOnly` `Secure` `SameSite=Strict` cookie scoped to `/profile/delete` |
| OAuth state, binding, nonce and PKCE verifier (deletion flow) | credentials | hashes in `oauth_states` (the verifier in plaintext for at most 10 minutes), deleted on use or expiry; database volume encrypted with AES-256 | TLS 1.2+; binding in an `HttpOnly` `Secure` `SameSite=Lax` cookie |
| Google ID token and claims (`sub`, `auth_time`) | credentials | never stored; the claims are used in memory | TLS 1.2+ from Google |
| session cookies | credentials | refresh token stored as a SHA-256 hash in `sessions`, removed by the deletion cascade; database volume encrypted with AES-256 | TLS 1.2+; `HttpOnly` `Secure` `SameSite=Strict` cookies |
| all personal and financial data of the user (profile, preferences, email, display name, accounts and balances of DISC-001-02a, identities, 2FA material) | PII and financial | erased by this ticket through the cascade; encrypted at rest with the database volume (AES-256) until then | TLS 1.2+ |
| deletion audit log (user id, session id, IP, request id, outcome) | PII | application logs without email, password, code or grant; retention is the platform's log retention | TLS 1.2+ to the log platform |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A stolen session, or a stolen password, deletes the account of a user who has 2FA | S | M | H | the second factor is required on every deletion path when 2FA is enabled (password path and grant path), checked with the code and limits of 01c before anything is deleted; tests for AC-03 and AC-04 (Blocks 3 and 4) |
| R-02 | The weaker re-authentication is chosen: a Google grant used for an account that has a password, or a password-less path used by a password account | E | M | H | `DeleteUser` decides the path from the account (a password account ignores any grant cookie), the start route refuses a password account, and a test shows a live grant does not delete such an account (AC-10) |
| R-03 | A deletion grant is stolen, replayed or used from another session or user | S | M | H | the grant is a 256-bit token stored hashed, bound to user, session family and credentials version, valid 5 minutes, consumed once by a conditional `DELETE … RETURNING` inside the deletion transaction, delivered only in a `Strict` `HttpOnly` cookie scoped to `/profile/delete` and never in a URL; tests for AC-09 and the parallel-use race (Block 4) |
| R-04 | Password or code guessing through the delete route, or locking the owner out of sign-in by burning the budget | S | M | M | the limits are reserved before any hashing or code check (reserve-then-refund) with the sign-in policies for passwords and `TWO_FACTOR_DISABLE_POLICIES` for codes, so parallel guesses share them and an over-limit request costs nothing; the lockout of the owner for 15 minutes needs a live session and is what AC-02 of the PRD asks (tests for NFR-02, Block 3) |
| R-05 | Login CSRF or confusion on the shared Google callback: an attacker's Google account or a stale state makes a victim's browser complete a deletion re-authentication, or a deletion state signs someone in | S | M | H | the state is single use and bound to the browser by the Lax binding cookie, stores the user and session it was started for, and the callback issues a grant only when Google's `sub` is linked to exactly that user and that session family is still live; the purpose stored in the state selects the branch, so a `delete_account` state never resolves, links or creates an account and a `sign_in` state never issues a grant; every refusal ends in the same redirect (tests for AC-06 and AC-07, Block 4) |
| R-06 | Personal data left behind after deletion, because a table was added without a cascading foreign key, or outbox rows keep the address | T | M | H | one transaction with `ON DELETE CASCADE`; the erasure guard discovers the whole foreign-key graph from `users`, fails for an unregistered table or a non-cascading key, and counts 0 rows per registered table including `accounts`; the `email_outbox` rows are deleted by user id and by address; `auth_attempts` counters are purged by the worker after 24 hours (existing retention); tables of DISC-001-02b, DISC-001-07a and the movements of PRD 03 must register when they merge (NFR-01, Block 3) |
| R-07 | A password reset or other credential change lands between the checks and the delete, so the account is deleted on stale credentials | T | L | M | the delete is conditional on the credentials version read before the checks, and a grant carries the version it was issued for; race tests answer 401 and keep the account (Block 3) |
| R-08 | A deletion is denied afterwards with no audit trail, or personal data and secrets land in logs | R | L | M | the route logs user id, session id, IP, request id and outcome for every attempt (kept after the rows are deleted); the password, codes, the grant, states, binding, claims and the email are never logged, asserted by tests (Blocks 3 and 4) |
| R-09 | `auth_time` is not returned by Google for `max_age=0`, so "Google asked for the credentials again" cannot be verified | S | M | M | the request carries `prompt=login` and `max_age=0`; `auth_time` is enforced when present; when absent the control is `prompt=login` plus the single-use state created at most 10 minutes before and the 5-minute grant; the behaviour is checked once with a real Google account after the deploy (manual verification step); accepted by the owner, see below |
| R-10 | Cross-site request forgery of `POST /profile/delete` or the start route | T | L | H | `SameSite=Strict` session cookies plus the origin guard (web origin and `X-Requested-With`) on every non-safe method; the password and the code in the body are unknown to a cross-site form |
| R-11 | A refused or failed deletion leaves a half-state (grant used but account kept, TOTP step spent) | T | L | L | the grant is consumed only in the deletion transaction, after the second factor passed; a wrong code leaves the grant valid until it expires; a spent TOTP step or recovery code on a later failure only costs the user one code, as in disabling 2FA |
| R-12 | Contention or deadlock in the deletion transaction (its cascade locks rows that refresh, verify or disable also lock; the outbox cleanup scans a table that the worker locks while sending) degrades the service or leaves a request hanging | D | L | M | the transaction sets a 5-second `lock_timeout`, takes locks in the order the email worker already uses (outbox rows first, skipping rows the worker holds, then the grant and the user and its cascade), uses expression and partial indexes for the outbox match, and requests no pool connection while open; a session created for a user deleted meanwhile is refused with 401; a concurrency test with refresh, verify and delete on a small pool must end as 204 or 401 (Block 3) |
| R-13 | A table added by a later module keeps a restricting foreign key or no registry entry, so the deletion fails with 500 or leaves data behind | T | M | M | the erasure guard fails for an unregistered reachable table and for a non-cascading key, so the owner of that table has to decide its erasure in its own ticket (DISC-001-02b categories, DISC-001-07a and the movements of PRD 03 register when they merge) |

## Accepted risks
### R-09
- **Accepted by:** project owner (human decision relayed by the orchestrator, 2026-10-02)
- **Justification:** if Google omits `auth_time`, failing closed would make deletion impossible for Google users; the remaining controls (`prompt=login`, a single-use state bound to the browser, the linked-subject check, the live session family, a 5-minute single-use grant, and the second factor when enabled) leave an attacker who already controls the victim's session and browser needing to pass Google's own prompt.
- **Review conditions:** after the manual verification with a real Google account once deployed (whether the ID token carries `auth_time` with `max_age=0`; its result is recorded in the pull request), or if Google changes the claim, or before offering Google deletion to accounts without 2FA at scale.

## Supply chain
No new runtime or development dependency is added (spec: "Justified new dependencies: None"): the grant uses the existing token generator and `node:crypto`, the Google flow reuses `jose` and the OIDC adapter, and the erasure guard uses `pg` queries already in the tests, so `pnpm audit --prod --audit-level high` covers the dependency surface unchanged.

## Availability
The expensive operations are Argon2id (password and recovery codes) and the Google token exchange; the limits are reserved before them, so an attacker cannot multiply the work, and over-limit requests answer 429 without hashing. The start route has the per-IP Google limit, grants and states are one row per user or flow and are purged after expiry by the worker, and the deletion transaction touches only the user's own rows. The API is stateless, so any instance can serve any step of the flow (the state, binding and grant live in the database and cookies).
