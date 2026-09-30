# Threat model DISC-001-01b: Google Sign-In

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01b |
| Spec | docs/ddw/specs/spec-DISC-001-01b.md |
| Tier | FEATURE |
| Date | 2026-09-28 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/identity/infrastructure/db/schema.ts` (`user_identities`, `oauth_states`, nullable `password_hash`) | Block 1 |
| `apps/api/src/identity/infrastructure/security/google-oidc-identity-provider.ts` | Block 2 |
| `apps/api/src/identity/infrastructure/http/google-routes.ts` (`GET /auth/google/start`, `GET /auth/google/callback`) | Block 3 |
| `apps/api/src/identity/application/complete-google-sign-in.ts` + `apps/api/src/identity/application/confirm-password-reset.ts` | Block 3 |
| `apps/web/src/features/auth/components/google-sign-in-button.tsx` + sign-in container | Block 4 |

## Trust boundaries
- Browser → API (Express): public internet; the start request and Google's redirect back (authorization code, state) over TLS; the binding cookie and the session cookies.
- API → Google token endpoint: public internet; authorization code, PKCE verifier and client secret leave the system, over TLS, only to the configured Google endpoint.
- API → Google JWKS endpoint: public internet; public keys only.
- Google → browser: the consent screen and the redirect back are outside our control; Google's answer is trusted only after the ID token is verified.
- API → PostgreSQL: private network; identities, OAuth states, users, sessions.

## STRIDE analysis
### `apps/api/src/identity/infrastructure/db/schema.ts` (`user_identities`, `oauth_states`, nullable `password_hash`)
- **Spoofing:** `unique (provider, subject)` means one Google account maps to at most one user; `unique (user_id, provider)` means one Google account per user (R-35).
- **Tampering:** Drizzle parameterized statements only; `consume` is a single `delete … returning`, so a state cannot be used twice (R-27).
- **Repudiation:** `user_identities.created_at` records when a Google account was linked; supersede sets `password_changed_at`.
- **Information Disclosure:** state, binding and nonce are stored only as SHA-256 hashes; the PKCE verifier is stored for at most 10 minutes and grants nothing without the code and client secret (R-31); no Google token is stored.
- **Denial of Service:** `oauth_states` rows are capped by the start rate limit and purged by the worker after expiry (R-33); lookups are by primary key.
- **Elevation of Privilege:** a password-less user cannot be signed into with any password: sign-in verifies the dummy hash for timing only and refuses a null hash explicitly (R-34).

### `apps/api/src/identity/infrastructure/security/google-oidc-identity-provider.ts`
- **Spoofing:** the ID token is accepted only with a valid RS256 signature from Google's JWKS, the right audience and issuer, an unexpired `exp`, and the nonce issued with this state (R-25, R-28).
- **Tampering:** the code is exchanged with the PKCE verifier over TLS directly with Google; an intercepted code is useless without the verifier and the client secret (R-26).
- **Repudiation:** every failure is logged with an internal reason (bad signature, audience, issuer, expiry, nonce, timeout), never with the token.
- **Information Disclosure:** the client secret comes from environment secrets and is sent only to the configured token endpoint, which production pins to Google's (R-32); tokens and codes are never logged.
- **Denial of Service:** 2 s timeout on the token call; the JWKS is cached so a flood of callbacks does not multiply key fetches (R-33).
- **Elevation of Privilege:** `alg` is pinned to RS256, so `none` or HS256-with-public-key tokens are rejected (R-25).

### `apps/api/src/identity/infrastructure/http/google-routes.ts` (`GET /auth/google/start`, `GET /auth/google/callback`)
- **Spoofing:** the callback requires a state bound to this browser through the binding cookie, which an attacker cannot set on the victim's browser, so an attacker's code cannot sign the victim into the attacker's account (login CSRF, R-27).
- **Tampering:** query values are parsed by a Zod schema with length limits; unknown parameters are stripped; the `Location` of every redirect is built from `WEB_BASE_URL` and the stored language, never from a query value (open redirect, R-30).
- **Repudiation:** start and callback outcomes are logged with the user id when known and the failure reason.
- **Information Disclosure:** every failure gives the same redirect (`error=google_failed`), so the callback does not reveal whether an email has an account (R-29).
- **Denial of Service:** starts are limited to 20 per IP per 15 minutes before any row is written (R-33).
- **Elevation of Privilege:** the binding cookie is `HttpOnly; Secure; SameSite=Lax; Path=/auth/google`, short-lived and cleared on callback; session cookies keep their DISC-001-01a attributes.

### `apps/api/src/identity/application/complete-google-sign-in.ts` + `apps/api/src/identity/application/confirm-password-reset.ts`
- **Spoofing:** an unverified Google email never creates or links an account (R-29); a Google email links to or supersedes an existing account only when Google is authoritative for it, `gmail.com` or a Workspace `hd` claim (R-37); a password reset removes non-authoritative Google identities (R-37).
- **Tampering:** create, link and supersede run in one transaction; a concurrent duplicate retries once and otherwise fails closed (R-35).
- **Repudiation:** linking and superseding are logged with the user id.
- **Information Disclosure:** the use case returns only the user and session; the email is never logged.
- **Denial of Service:** one transaction of indexed lookups per callback.
- **Elevation of Privilege:** when a Google-verified email matches an unverified password account, the password is removed, the credentials version bumped and all sessions revoked before linking, so whoever pre-registered the email loses access (pre-hijacking, R-24b).

### `apps/web/src/features/auth/components/google-sign-in-button.tsx` + sign-in container
- **Spoofing:** the button only navigates to our API; the web app never sees a Google token.
- **Tampering:** only `error=google_failed` is recognized from the URL; any other value is ignored.
- **Repudiation:** no state-changing action in the web app; outcomes are logged by the API.
- **Information Disclosure:** no Google script is loaded, so no third party runs in our pages and the CSP is unchanged (R-36).
- **Denial of Service:** none beyond the API's start limit.
- **Elevation of Privilege:** the web app gains no new privilege; sessions are the API's cookies.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Google client secret | credentials | environment secret only; never in the database or logs | TLS 1.2+ to Google's token endpoint only |
| authorization code | credentials | never stored | TLS 1.2+ (query from Google redirect, then to the token endpoint) |
| ID token | credentials | never stored; claims used in memory | TLS 1.2+ from Google |
| state, binding, nonce | credentials | SHA-256 hashes in `oauth_states`, deleted on use or after 10 min; database volume encrypted with AES-256 | TLS 1.2+; binding in an `HttpOnly` `Secure` `SameSite=Lax` cookie |
| PKCE code verifier | credentials | plaintext in `oauth_states` for at most 10 min; database volume encrypted with AES-256 | TLS 1.2+ to Google's token endpoint only |
| Google subject (`sub`) | PII | `user_identities.subject`; database volume encrypted with AES-256 | TLS 1.2+ |
| email address | PII | as in DISC-001-01a; never logged | TLS 1.2+ |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-24b | account pre-hijacking: someone registers the victim's email with a password before the victim uses Google | E | M | C | Google-verified email supersedes the unverified account: password removed, credentials version bumped, sessions revoked, then linked (PRD AC-07) |
| R-25 | forged, altered or `alg`-confused ID token | S | L | C | RS256 pinned; signature against Google JWKS; `aud`, `iss`, `exp` checked (NFR-02) |
| R-26 | intercepted authorization code redeemed by an attacker | S | L | H | PKCE S256 plus confidential client secret; code is single-use at Google |
| R-27 | login CSRF / state replay: victim signed into the attacker's account, or a state used twice | S | M | H | state bound to a browser binding cookie, stored hashed, single-use atomic delete, 10 min expiry |
| R-28 | ID token replay from another flow | S | L | H | nonce issued per state and checked against its stored hash |
| R-29 | account creation, linking or enumeration through an unverified Google email (an attacker's Google account claiming the victim's email keeps its link after the victim verifies it) | I | M | H | an unverified Google email never creates or links (PRD AC-05, AC-08); identical failure redirect for every failure |
| R-30 | open redirect through the callback | T | M | M | redirect targets built only from `WEB_BASE_URL` and a stored `es`/`en` value |
| R-31 | database dump exposes OAuth secrets | I | L | M | hashes for state, binding and nonce; verifier short-lived and useless alone; no tokens stored |
| R-32 | client secret sent to a non-Google endpoint through configuration | I | L | H | production rejects any `GOOGLE_*` endpoint other than Google's |
| R-33 | flooding starts or callbacks to fill `oauth_states` or hammer Google | D | M | L | 20 starts per IP per 15 min; rows purged after expiry; JWKS cached; 2 s token timeout |
| R-34 | password sign-in against a password-less account (including with the dummy hash's preimage) | S | L | H | the dummy hash is verified only for equal timing; a null hash is refused explicitly with `INVALID_CREDENTIALS` whatever the result (SAST M-1) |
| R-35 | race creating two users or two identities for one Google account | T | L | M | unique constraints; one retry, then fail closed |
| R-36 | third-party script in the web app reads session context | I | L | H | no Google script; top-level redirect flow; CSP unchanged |
| R-37 | a Google account whose verified email is not authoritative (for example, created while someone else controlled the mailbox) takes over or keeps access to the account of the current mailbox owner | E | L | H | linking and superseding only for `gmail.com` or `hd` accounts (PRD AC-09); non-authoritative identities flagged at link time and deleted by a password reset, which proves current control of the mailbox |
| R-38 | someone registers the victim's `gmail.com` address with a password, the victim clicks the unsolicited verification link, then signs in with Google and the account is linked (AC-06) while the other person's password still works | E | L | H | accepted, see below |
| R-39 | a verified but non-authoritative Google account creates the account first; the real mailbox owner registering later gets the generic "verification sent" answer and no email, and is not told to reset the password (a reset would remove that Google link, R-37) | E | L | M | accepted, see below |

## Accepted risks
### R-38
- **Accepted by:** project owner (user), in the session of 2026-09-28, when approving the DISC-001-01b spec after architecture review round 2.
- **Justification:** the victim must confirm a registration they never made by clicking an unsolicited verification email; the gap belongs to the DISC-001-01a verification flow, not to Google linking, and closing it (for example, clearing the password or notifying the mailbox on link) changes 01a flows that fit the hardening ticket better. The product has about 10 users.
- **Review conditions:** in the identity hardening follow-up ticket, or before opening registration to more than a few hundred users, whichever comes first.

### R-39
- **Accepted by:** project owner (user), in the session of 2026-09-28, when approving the DISC-001-01b spec after architecture review round 2.
- **Justification:** it needs a Google account verified for an address its holder no longer controls, for a domain that is neither Gmail nor Workspace; the real owner can recover the account with a password reset, which also removes that Google link (R-37).
- **Review conditions:** in the identity hardening follow-up ticket (for example, telling a registering user to reset when the email already exists), or when the user base grows.

## Supply chain
No new runtime dependency: ID tokens are verified with `jose` (already pinned in `pnpm-lock.yaml`) and the token endpoint is called with the platform `fetch`. New external service: Google Identity (OAuth 2.0 / OpenID Connect), reached only from the API with a confidential client; the client secret is an environment secret with access limited to the API deployment. Tests use a local fake OIDC server, never Google.

## Availability
If Google's token or JWKS endpoints are down or slower than 2 s, Google sign-in fails with the
generic message and nothing is written; email and password sign-in (DISC-001-01a) is unaffected,
so users with a password keep access. Google-only users can set a password through password reset
while Google is down. DoS on the new routes is capped by the per-IP start limit (R-33); volumetric
attacks are handled at the hosting edge.
