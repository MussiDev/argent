# Threat model DISC-001-01a: Email & Password Authentication

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01a |
| Spec | docs/ddw/specs/spec-DISC-001-01a.md |
| Tier | FEATURE |
| Date | 2026-09-26 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/shared/http/validate.ts` + `apps/api/src/shared/http/error-handler.ts` | Block 1 |
| `apps/api/src/identity/infrastructure/db/schema.ts` | Block 2 |
| `apps/api/src/identity/infrastructure/security/hibp-breached-password-checker.ts` | Block 2 |
| `apps/api/src/identity/infrastructure/http/registration-routes.ts` (`POST /auth/register`, `POST /auth/verify-email`, `POST /auth/verification/resend`) | Block 3 |
| `apps/api/src/identity/infrastructure/email/email-worker.ts` | Block 3 |
| `apps/api/src/identity/infrastructure/http/session-routes.ts` (`POST /auth/sign-in`, `/auth/refresh`, `/auth/sign-out`, `/auth/sign-out-all`) | Block 4 |
| `apps/api/src/identity/infrastructure/http/password-reset-routes.ts` (`POST /auth/password-reset/request`, `/auth/password-reset/confirm`) | Block 5 |
| `apps/api/src/shared/http/require-session.ts` + `apps/api/src/shared/http/require-verified-email.ts` + `apps/api/src/shared/access/access-policy.ts` | Block 6 |
| `apps/web/src/app/[locale]/(auth)/` (register, verify, sign-in, forgot/reset password pages) | Block 7 |

## Trust boundaries
- Browser → web app (Next.js): public internet; page requests and static assets over TLS.
- Browser → API (Express): public internet; credentials, verification and reset tokens, session cookies over TLS; same registrable domain (PRD NFR-11).
- API → PostgreSQL: private network; password hashes, token hashes, sessions, rate-limit counters.
- API → Have I Been Pwned range API: public internet; only the first 5 hex characters of the SHA-1 of the password leave the system.
- API → email provider (Resend): public internet; recipient email and single-use links.
- Email inbox → browser: verification and reset links travel through the user's mail provider, outside our control.

## STRIDE analysis
### `apps/api/src/shared/http/validate.ts` + `apps/api/src/shared/http/error-handler.ts`
- **Spoofing:** not an identity surface; runs before and after authentication middleware without changing identity.
- **Tampering:** every body, query and param is parsed by a Zod schema; unknown keys are stripped, so mass-assignment of fields such as `emailVerifiedAt` is impossible (R-10).
- **Repudiation:** the error handler logs every 4xx/5xx with request id, route and error code, never with bodies.
- **Information Disclosure:** errors return a stable code and no stack trace or SQL message in production (R-11).
- **Denial of Service:** JSON body size limited to 16 KB before parsing (R-12).
- **Elevation of Privilege:** validation cannot grant roles; there are no roles in this ticket.

### `apps/api/src/identity/infrastructure/db/schema.ts`
- **Spoofing:** emails stored lower-cased with a unique index, so two accounts cannot claim the same address with different casing.
- **Tampering:** all queries go through Drizzle parameterized statements; no string-built SQL (R-13).
- **Repudiation:** `created_at`, `used_at`, `revoked_at` columns record when tokens and sessions were issued, used and revoked.
- **Information Disclosure:** passwords stored only as Argon2id hashes; verification, reset and refresh tokens stored only as SHA-256 hashes, so a database dump yields no usable secret (R-05).
- **Denial of Service:** indexes on `users.email`, `sessions.token_hash`, `auth_attempts(key, window_start)` keep lookups bounded.
- **Elevation of Privilege:** the application database role has DML rights only; migrations run with a separate role.

### `apps/api/src/identity/infrastructure/security/hibp-breached-password-checker.ts`
- **Spoofing:** calls only `https://api.pwnedpasswords.com/range/` over TLS with certificate validation.
- **Tampering:** a tampered response can only cause a false accept or false reject of one password; it cannot change stored data.
- **Repudiation:** provider failures are logged with timestamp and latency.
- **Information Disclosure:** k-anonymity: only a 5-character SHA-1 prefix is sent; the password and full hash never leave the API.
- **Denial of Service:** 400 ms timeout; on timeout or error the request is rejected with `PASSWORD_CHECK_UNAVAILABLE` (fail-closed, R-07), so an outage cannot be used to register a breached password.
- **Elevation of Privilege:** not applicable; the checker returns a boolean and holds no privileges.

### `apps/api/src/identity/infrastructure/http/registration-routes.ts`
- **Spoofing:** open registration lets anyone create accounts; accounts cannot reach financial data until the email is verified (R-03).
- **Tampering:** the client-sent time zone and language are validated against the IANA list and `es|en`; anything else falls back to defaults.
- **Repudiation:** registrations and verifications are logged with account id, IP and timestamp (no email in logs).
- **Information Disclosure:** registering an existing email returns the same 202 response and body as a new one, runs a dummy Argon2id hash and inserts a `discard` outbox row, so work and timing match (R-02).
- **Denial of Service:** 5 registrations per IP per hour; Argon2id cost bounded by the same limiter, applied before hashing (R-04).
- **Elevation of Privilege:** verification tokens are 256-bit random, single-use and expire in 24 h; guessing one is infeasible (R-06).

### `apps/api/src/identity/infrastructure/email/email-worker.ts`
- **Spoofing:** the sending domain is configured with SPF, DKIM and DMARC so users can tell real emails from phishing.
- **Tampering:** link URLs are built from a configured base URL, never from the request `Host` header, so an attacker cannot make the API email links to their own domain (R-08).
- **Repudiation:** the provider message id is logged per send.
- **Information Disclosure:** emails contain only the link and the user's language copy; no password or account data.
- **Denial of Service:** resend of verification limited to 3 per account per hour to avoid email bombing a victim (R-09).
- **Elevation of Privilege:** the provider API key has send-only scope and lives in the environment, never in the repository.

### `apps/api/src/identity/infrastructure/http/session-routes.ts`
- **Spoofing:** credential stuffing and brute force limited to 5 failures per account and 20 per IP per 15 minutes (R-01).
- **Tampering:** access tokens are HS256-signed JWTs verified on every request; refresh tokens are opaque and compared by hash (R-14).
- **Repudiation:** every sign-in success and failure, refresh, sign-out and sign-out-all is logged with account id (when known), session id, IP and outcome.
- **Information Disclosure:** wrong email and wrong password return the same message, status and timing (R-02); cookies are `HttpOnly`, `Secure`, `SameSite=Strict`.
- **Denial of Service:** the limiter runs before Argon2id verification, so failed attempts cannot exhaust CPU (R-04).
- **Elevation of Privilege:** refresh-token reuse after rotation revokes the whole session family, limiting a stolen refresh token to one use (R-15); access tokens are checked against the `sessions` row so a revoked session stops working immediately (R-16).

### `apps/api/src/identity/infrastructure/http/password-reset-routes.ts`
- **Spoofing:** reset requires control of the verified inbox; tokens are 256-bit, hashed, single-use, 60-minute expiry (R-06).
- **Tampering:** the new password goes through the same policy (length and breach check) as registration.
- **Repudiation:** reset requests and completions are logged with account id and IP.
- **Information Disclosure:** the request endpoint answers identically for registered and unknown emails (R-02); reset pages send `Referrer-Policy: no-referrer` so the token does not leak to third parties (R-17).
- **Denial of Service:** reset requests limited per IP and per email with the same limiter as registration (R-09).
- **Elevation of Privilege:** completing a reset revokes all existing sessions, evicting an attacker who held one (PRD AC-10).

### `apps/api/src/shared/http/require-session.ts` + `apps/api/src/shared/http/require-verified-email.ts` + `apps/api/src/shared/access/access-policy.ts`
- **Spoofing:** `requireSession` accepts only a valid, unexpired, signed access token whose session row is not revoked; otherwise 401.
- **Tampering:** the user id is taken from the verified token, never from the request body or query.
- **Repudiation:** denied accesses are logged with user id, route and reason.
- **Information Disclosure:** resources not owned and not shared answer 404, never 403, so their existence is not revealed (PRD AC-15).
- **Denial of Service:** the session lookup is a single indexed read per request.
- **Elevation of Privilege:** every repository query on user data takes the owner scope from `AccessPolicy`; a query without scope fails a lint rule and code review (R-18). `requireVerifiedEmail` blocks unverified accounts from financial data.

### `apps/web/src/app/[locale]/(auth)/`
- **Spoofing:** the web app never stores credentials or tokens; host-only cookies are set by the API, and CORS allows credentials only from `WEB_ORIGIN`.
- **Tampering:** state-changing API calls carry a custom header and the API checks `Origin` against the web origin, on top of `SameSite=Strict` (R-19).
- **Repudiation:** not applicable in the client; the API logs every action.
- **Information Disclosure:** tokens are never readable from JavaScript (`HttpOnly`); a Content-Security-Policy with no inline scripts limits XSS impact (R-20).
- **Denial of Service:** not applicable; the client only renders forms.
- **Elevation of Privilege:** route guards are UX only; authorization is enforced by the API on every request.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| password | credentials | Argon2id (m=19 MiB, t=2, p=1); plaintext never stored or logged | TLS 1.2+ |
| refresh token | credentials | SHA-256 hash in `sessions`; database volume encrypted with AES-256 by the managed provider | TLS 1.2+, `HttpOnly` `Secure` `SameSite=Strict` cookie |
| access token (JWT) | credentials | not stored server-side; signing key in environment secrets | TLS 1.2+, `HttpOnly` `Secure` `SameSite=Strict` cookie |
| verification / reset token | credentials | SHA-256 hash; database volume encrypted with AES-256 | TLS 1.2+ in the link; email transport outside our control |
| email address | PII | database volume encrypted with AES-256 by the managed provider; never written to logs | TLS 1.2+ |
| IP address (rate limiting, logs) | PII | `auth_attempts` rows deleted after 24 h; database volume encrypted with AES-256 | TLS 1.2+ |
| time zone, language, default rate type, display currency | public | plain columns | TLS 1.2+ |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | credential stuffing / brute force on sign-in | S | H | H | 5 failures per account and 20 per IP per 15 min, stored in PostgreSQL (NFR-03) |
| R-02 | account enumeration through responses or timing | I | H | M | identical status/body for known and unknown emails; dummy Argon2id verify (NFR-08) |
| R-03 | bot registrations | S | M | M | email verification before data access; 5 registrations per IP per hour |
| R-04 | CPU exhaustion through Argon2id | D | M | H | rate limiter applied before hashing; body size limit |
| R-05 | database dump exposes secrets | I | L | C | Argon2id for passwords; SHA-256 for all tokens; encrypted volume |
| R-06 | guessing verification or reset tokens | E | L | C | 256-bit random, hashed, single-use, 24 h / 60 min expiry |
| R-07 | breached password accepted while HIBP is down | S | L | M | fail-closed: 400 ms timeout, request rejected with 503 `PASSWORD_CHECK_UNAVAILABLE`, nothing persisted |
| R-08 | host-header injection in email links | T | M | H | links built from configured `WEB_BASE_URL` only |
| R-09 | email bombing a victim via resend/reset | D | M | M | 3 resends per account per hour; reset limited per IP and per email |
| R-10 | mass assignment of protected fields | T | M | H | Zod schemas strip unknown keys; handlers receive only typed fields |
| R-11 | stack traces or SQL errors leaked | I | M | M | central error handler returns codes only in production |
| R-12 | oversized payloads | D | M | L | 16 KB JSON limit |
| R-13 | SQL injection | T | L | C | Drizzle parameterized queries only |
| R-14 | forged or altered access token | T | L | C | HS256 signature verified with a ≥ 256-bit secret; `alg` pinned |
| R-15 | stolen refresh token reused | E | M | H | rotation with family revocation on reuse |
| R-16 | revoked session keeps working until JWT expiry | E | M | M | session row checked on every request |
| R-17 | reset/verify token leaked via Referer | I | L | H | `Referrer-Policy: no-referrer` on token pages; tokens single-use |
| R-18 | a future query forgets owner scoping | E | M | C | `AccessPolicy` scope required by repository signatures; 404 test per resource |
| R-19 | cross-site request forgery | T | L | H | `SameSite=Strict`, custom header, `Origin` check |
| R-20 | XSS steals session | I | L | C | `HttpOnly` cookies; CSP without inline scripts; React escaping |

## Supply chain
New runtime dependencies: `express@5`, `zod`, `drizzle-orm`, `pg`, `@node-rs/argon2`, `jose`, `cookie-parser`, `helmet`, `resend` (API); `next@16`, `react`, `tailwindcss`, `lucide-react`, `next-intl`, shadcn/ui source copied into the repo (web). Versions are pinned through `pnpm-lock.yaml`, installs in CI use `--frozen-lockfile`, and the SAST step scans the result. External services: Have I Been Pwned (k-anonymity, no secrets sent) and Resend (send-only API key).

## Availability
DoS vectors in this ticket are Argon2id CPU cost, email sending and oversized bodies; all three are capped by the limiter and body limit above (R-04, R-09, R-12). Volumetric attacks are handled at the hosting edge and are out of scope for application code. HIBP outages make registration and password reset return 503 until it recovers (fail-closed, R-07); email provider outages only delay delivery, because emails go through the PostgreSQL outbox and are retried by the worker.
