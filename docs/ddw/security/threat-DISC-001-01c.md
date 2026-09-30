# Threat model DISC-001-01c: Two-Factor Authentication

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01c |
| Spec | docs/ddw/specs/spec-DISC-001-01c.md |
| Tier | FEATURE |
| Date | 2026-09-30 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/identity/infrastructure/security/totp.ts` + `aes-gcm-secret-box.ts` | Block 1 |
| `apps/api/src/identity/infrastructure/db/schema.ts` (`user_two_factor`, `recovery_codes`, `sign_in_challenges`) | Block 1 |
| `apps/api/src/identity/infrastructure/http/two-factor-routes.ts` (`GET /auth/2fa`, `POST /auth/2fa/setup`, `/enable`, `/disable`) | Block 2 |
| `apps/api/src/identity/application/verify-second-factor.ts` + `POST /auth/2fa/verify` + the modified `POST /auth/sign-in` and `GET /auth/google/callback` | Block 3 |
| `apps/web/src/features/two-factor/` + `apps/web/src/app/[locale]/(auth)/sign-in/second-factor/` | Block 4 |

## Trust boundaries
- Browser → API: TOTP codes, recovery codes, the challenge cookie and session cookies over TLS; the enable response carries the recovery codes once.
- Authenticator app ↔ user: the secret leaves the system once, as a QR code and text on the settings screen, into the user's device.
- API → PostgreSQL: the sealed TOTP secret, recovery code hashes, challenge token hashes.
- Environment secrets → API: `TOTP_ENCRYPTION_KEY`, separate from the database.

## STRIDE analysis
### `apps/api/src/identity/infrastructure/security/totp.ts` + `aes-gcm-secret-box.ts`
- **Spoofing:** codes are checked with a constant-time comparison over a window of ±1 step only (NFR-03, R-40); the authenticator entry reads "Pesly: <email>" with the email percent-encoded.
- **Tampering:** AES-256-GCM authenticates the sealed secret and binds it to the user id; a modified or moved value fails to open instead of verifying against a changed secret (R-42).
- **Repudiation:** enable, disable and second-factor outcomes are logged with the user id, never with a code or secret.
- **Information Disclosure:** the secret is stored only sealed; the key lives in environment secrets, so a database dump alone does not reveal it (R-42).
- **Denial of Service:** HMAC-SHA1 over three steps is constant and cheap.
- **Elevation of Privilege:** the last accepted step is stored per user and a code is accepted only for a later step, so an observed code cannot be replayed (R-41).

### `apps/api/src/identity/infrastructure/db/schema.ts` (`user_two_factor`, `recovery_codes`, `sign_in_challenges`)
- **Spoofing:** challenges and recovery codes belong to one user through a foreign key with cascade.
- **Tampering:** Drizzle parameterized statements; `advanceLastUsedStep`, `markUsed` and `consume` are single conditional statements, safe under concurrency (R-44).
- **Repudiation:** `enabled_at`, `used_at` and `created_at` record when 2FA was turned on and when each recovery code was used.
- **Information Disclosure:** recovery codes are stored only as Argon2id hashes (NFR-02); challenge tokens only as SHA-256 hashes (R-43).
- **Denial of Service:** expired challenges are purged by the worker; lookups are by primary key or indexed user id.
- **Elevation of Privilege:** the rollback that drops `user_two_factor` turns 2FA off for everyone and is marked destructive in its header (R-47).

### `apps/api/src/identity/infrastructure/http/two-factor-routes.ts` (`GET /auth/2fa`, `POST /auth/2fa/setup`, `/enable`, `/disable`)
- **Spoofing:** every route needs a session and a verified email; state-changing routes pass the `Origin` guard (CSRF).
- **Tampering:** enable requires a pending secret and a valid code and activates only the exact secret it verified; setup cannot replace an enabled secret (409, R-52).
- **Repudiation:** enable and disable are logged with the user id.
- **Information Disclosure:** recovery codes are returned only in the enable response; status returns a count (AC-02).
- **Denial of Service:** disable goes through the same per-user second-factor limit, so it is not a faster code oracle (R-40, R-45).
- **Elevation of Privilege:** disabling needs a valid TOTP or recovery code; enabling and disabling end the other sessions and email the owner (R-46).

### `apps/api/src/identity/application/verify-second-factor.ts` + `POST /auth/2fa/verify` + the modified `POST /auth/sign-in` and `GET /auth/google/callback`
- **Spoofing:** no session exists until the second factor passes, after either first factor, including Google (AC-04, AC-06); the challenge is bound to the browser by a `SameSite=Strict` cookie scoped to `/auth/2fa` (R-43).
- **Tampering:** the challenge stores the credentials version from the first factor; a password reset in between invalidates it (R-44).
- **Repudiation:** each failed and successful second factor is logged with user id and `via`.
- **Information Disclosure:** `second_factor_required` reveals that the password was right; this is inherent to 2FA and the attempt was already counted against the account limit (R-48).
- **Denial of Service:** per-user second-factor limits that wrong passwords cannot exhaust (R-51) and 5 attempts per challenge; recovery-code checks cost at most 10 sequential Argon2id verifications, behind the same limits and a perf budget (R-45).
- **Elevation of Privilege:** a TOTP code and a recovery code are each single-use; concurrent verifies of one code start at most one session (R-41, R-44).

### `apps/web/src/features/two-factor/` + `apps/web/src/app/[locale]/(auth)/sign-in/second-factor/`
- **Spoofing:** the web app only relays codes to the API; it holds no secret beyond the setup screen.
- **Tampering:** client-side validation mirrors the shared schemas; the API decides.
- **Repudiation:** no state changes in the web app beyond API calls.
- **Information Disclosure:** the QR code is generated in the browser with `qrcode`, never by a third-party service; recovery codes are shown once and not stored by the web app (R-49).
- **Denial of Service:** none beyond the API limits.
- **Elevation of Privilege:** the settings screen is inside the authenticated shell; the second-factor screen works only with a live challenge cookie.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| TOTP secret | credentials | AES-256-GCM sealed with `TOTP_ENCRYPTION_KEY` (environment secret); database volume encrypted with AES-256 | TLS 1.2+; shown once on the settings screen |
| recovery codes | credentials | Argon2id hashes only; database volume encrypted with AES-256 | TLS 1.2+; returned once by enable |
| sign-in challenge token | credentials | SHA-256 hash only, deleted on use or after 5 minutes; database volume encrypted with AES-256 | TLS 1.2+; `HttpOnly` `Secure` `SameSite=Strict` cookie |
| `TOTP_ENCRYPTION_KEY` | credentials | environment secret of the API service only | never transmitted by the application |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-40 | brute force of 6-digit codes by someone holding the password | S | M | H | per-user second-factor limit of 5 per 15 min and 20 per 24 h (NFR-04), 5 attempts per challenge, and every failure also recorded on the shared sign-in counter (NFR-01): at most 20 guesses a day at 3 accepted codes per guess, about 0.006% a day (about 2% a year of continuous attempts) |
| R-41 | replay of an observed TOTP code or recovery code | S | M | H | last accepted step stored per user; recovery codes marked used atomically |
| R-42 | database dump exposes TOTP secrets, or a sealed secret is copied to another user's row | I | L | C | secrets sealed with AES-256-GCM with the user id as authenticated data; key outside the database |
| R-43 | sign-in challenge stolen or fixed by another site | S | L | H | random 256-bit token stored hashed, `SameSite=Strict` cookie scoped to `/auth/2fa`, 5-minute expiry, single use |
| R-44 | race between verify, reset and concurrent verifies | T | L | M | atomic consume and step advance; credentials version checked before the session starts |
| R-45 | CPU exhaustion through recovery-code Argon2id checks | D | L | M | at most 10 verifications per attempt, behind the per-account limit |
| R-46 | stolen session turns 2FA off, or enrolls the attacker's authenticator | E | M | H | disable requires a valid code and is limited; enable and disable end every other session and email the owner (FR-05), so the owner learns of it and the thief keeps no other session |
| R-47 | rollback of `0005` silently disables 2FA | E | L | H | rollback marked destructive; explicit plan required (AGENTS.md) |
| R-48 | `second_factor_required` confirms a correct password | I | M | L | inherent to 2FA; the password attempt is already counted; accepted by design |
| R-49 | recovery codes or secret leak from the screen, browser storage or caches | I | L | H | shown once, never stored by the web app, QR generated locally, `Cache-Control: no-store` on setup and enable |
| R-50 | a Google identity is linked (DISC-001-01b) before the second factor, so a failed second factor leaves the link in place | T | L | L | links only happen for Google-authoritative emails (DISC-001-01b FR-07); the link grants no session without the second factor |
| R-51 | someone who only knows an email locks its owner out of the second step (revisits DISC-001-01a R-23 for 2FA users) | D | M | M | wrong passwords touch only the shared counter, and the second step is limited per user (NFR-04), so a pending challenge can always be completed; the password step keeps the 15-minute lockout accepted in R-23 |
| R-52 | setup racing enable activates a secret the user never confirmed | T | L | H | conditional upsert and conditional activate on the exact verified sealed value |

## Supply chain
New runtime dependency: `qrcode` in the web app, pinned in `pnpm-lock.yaml` and scanned by `pnpm audit` in CI; it only renders a string it is given. No new API dependency: TOTP and encryption use `node:crypto`. New secret: `TOTP_ENCRYPTION_KEY` on the API service; rotating it requires re-sealing every secret, which is out of scope and recorded for the identity hardening ticket.

## Availability
If `TOTP_ENCRYPTION_KEY` is missing outside production, 2FA answers 503 and users without 2FA are
unaffected; production refuses to start without it. Losing the key makes every enrolled user unable
to pass the second factor until they use a recovery code and re-enroll, so the key must be backed up
with the other production secrets. The second factor adds one request to sign-in and no external
call.
