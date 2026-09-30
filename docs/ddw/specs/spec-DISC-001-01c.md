# Spec DISC-001-01c: Two-Factor Authentication

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01c |
| PRD | docs/ddw/prd/prd-DISC-001-01c.md |
| Tier | FEATURE |
| Date | 2026-09-30 |
| Spec loops | 1 |
| Loops since last human decision | 0 |

## Summary
Adds an optional TOTP second factor to the `identity` module. A signed-in user with a verified email
enrolls from a new security settings screen: the API generates a 160-bit secret, stores it encrypted
(AES-256-GCM, bound to the user id, key from the environment) and shows it as a QR code and as text;
confirming one valid code activates 2FA and returns 10 recovery codes once, stored only as Argon2id
hashes. Enabling or disabling 2FA ends the user's other sessions and emails a notice. After any first
factor — password (DISC-001-01a) or Google (DISC-001-01b) — a user with 2FA gets no session: the API
stores a short-lived, single-use sign-in challenge in PostgreSQL, bound to the browser by a cookie,
and starts the session only when a valid TOTP code (never reused) or an unused recovery code is
posted. Failed codes count toward the existing per-account sign-in limit and are also limited per
user, and failed passwords never block the second step. Block 1 adds the TOTP engine, the encryption
adapter and persistence; Block 2 enrollment, disabling and notices; Block 3 the second step of
sign-in; Block 4 the web screens.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2, Block 4 |
| FR-02 | Block 2, Block 4 |
| FR-03 | Block 1, Block 2, Block 4 |
| FR-04 | Block 1, Block 3, Block 4 |
| FR-05 | Block 1, Block 2, Block 4 |
| NFR-01 | Strategy: every failed TOTP or recovery code (in verify and in disable) records one unit in the existing `sign_in_account` policy keyed by `Email.parse(user.email).value`, the same key password sign-in uses, and keeps it; a success gives it back. The second step does not refuse on that counter (NFR-04 does the limiting), so the codes count toward the sign-in limit without letting wrong passwords block the second step (Block 3, Block 2). Test: after 3 wrong codes, 2 wrong passwords make the next password attempt answer 429. |
| NFR-02 | Strategy: recovery codes (50 random bits each) are hashed with the existing `Argon2idPasswordHasher` before any transaction opens and stored only as hashes in `recovery_codes`; the plaintext exists only in the enable response, sent with `Cache-Control: no-store` (Block 1, Block 2). A test reads the table after enabling and finds no code in plain text. |
| NFR-03 | Strategy: a pure RFC 6238 implementation in `apps/api/src/identity/infrastructure/security/totp.ts` (HMAC-SHA1 via `node:crypto`, 6 digits, 30 s step, window of ±1 step, constant-time comparison), tested against the RFC 6238 Appendix B vectors and at the window edges; the last accepted step is stored per user and a code is accepted only for a later step (atomic conditional update), so a code cannot be replayed (Block 1). |
| NFR-04 | Strategy: two new attempt policies keyed by user id, `second_factor_user_15m` (5 per 15 minutes) and `second_factor_user_24h` (20 per 24 hours), recorded with the reserve-then-refund pattern of DISC-001-01a and FIX-001 before any code is checked: a refusal gives its units back and answers 429 (a failed refund is reported and does not turn the 429 into a 500), a failure keeps them, a success gives them back. Password failures touch only `sign_in_account`, so they never block the second step. Each challenge also allows at most 5 attempts (Block 3). Tests: 5 wrong passwords do not block a valid second factor; the 6th wrong code within 15 minutes and the 21st within 24 hours answer 429. |

## Dependencies between blocks
Block 1 → Block 2 → Block 3 → Block 4. Block 2 and Block 3 use Block 1's engine and repositories;
Block 4 uses the routes of Blocks 2 and 3. Execution order: 1, 2, 3, 4.

## Justified new dependencies
- `qrcode` (web, runtime) — renders the `otpauth://` URI as an SVG data URL in the browser, so the
  secret never goes to a third-party QR service; `@types/qrcode` (web, dev); `pnpm-lock.yaml` is
  updated with them (CI installs with `--frozen-lockfile`). The CSP already allows `img-src data:`
  (`apps/web/src/lib/content-security-policy.ts:18`).
- No API dependency: TOTP uses `node:crypto` HMAC and the secret encryption `node:crypto`
  AES-256-GCM.

## Block 1 — TOTP engine, secret encryption and persistence

**Files**
- Ports in `apps/api/src/identity/application/ports/` (new):
  - `totp.ts` — `TotpEngine`: `generateSecret(): string` (base32), `verify(secret, code, now): number | null` (matched step or null), `otpauthUri(secret, accountEmail): string`.
  - `secret-box.ts` — `SecretBox`: `seal(plaintext, associatedData): string`, `open(sealed, associatedData): string`; `SecretBoxUnavailable extends Error`.
  - `recovery-code-generator.ts` — `RecoveryCodeGenerator`: `generate(count): string[]`.
  - `two-factor-repository.ts` — `findByUserId`, `savePending(userId, sealed): Promise<boolean>` (false when 2FA is already enabled), `activate(userId, sealed, at): Promise<boolean>` (only when still pending with that exact secret), `advanceLastUsedStep(userId, step): Promise<boolean>` (only when `step > last_used_step`), `delete(userId)`.
  - `recovery-code-repository.ts` — `replaceAll(userId, hashes)`, `findUnused(userId)`, `markUsed(id, at): Promise<boolean>` (only when unused), `countUnused(userId)`, `deleteAll(userId)`.
  - `sign-in-challenge-repository.ts` — `create(challenge)`, `lockLive(tokenHash, now)` (`select … for update` inside a unit of work), `recordAttempt(tokenHash): Promise<number>`, `consume(tokenHash)`, `deleteForUser(userId)`.
  - `sign-in-challenge-purger.ts` — `purgeExpired(now): Promise<number>`, mirroring `oauth-state-purger.ts`.
- `apps/api/src/identity/application/ports/unit-of-work.ts` (modified) — `TransactionalRepositories` gains `twoFactor`, `recoveryCodes`, `signInChallenges`.
- `apps/api/src/identity/application/ports/session-repository.ts` (modified) — `revokeAllForUserExcept(userId, sessionId, at)`.
- `apps/api/src/identity/application/ports/attempt-limiter.ts` (modified) — attempt kinds `second_factor_user_15m`, `second_factor_user_24h`.
- `apps/api/src/identity/application/ports/email-sender.ts` (modified) — outbox kinds `two_factor_enabled`, `two_factor_disabled`.
- `apps/api/src/identity/domain/recovery-code.ts` (new) — pure formatting and normalization: 10 Crockford base32 characters shown as `xxxxx-xxxxx`; input upper-cased, spaces and dashes removed, `I`/`L` read as `1` and `O` as `0`.
- Adapters in `apps/api/src/identity/infrastructure/security/` (new):
  - `totp.ts` — `RfcTotpEngine`; the URI is `otpauth://totp/Pesly:${encodeURIComponent(email)}?secret=…&issuer=Pesly&algorithm=SHA1&digits=6&period=30`.
  - `aes-gcm-secret-box.ts` — AES-256-GCM with a random 96-bit IV per seal, the user id as additional authenticated data, format `v1.<keyId>.<iv>.<ciphertext>.<tag>` (base64url; `keyId` = first 8 hex characters of SHA-256 of the key). Also `UnavailableSecretBox`, used when the key is unset outside production.
  - `crypto-recovery-code-generator.ts` — 50 random bits per code from `randomBytes`.
- `apps/api/src/shared/config/env.ts` (modified) — `TOTP_ENCRYPTION_KEY` (base64 of exactly 32 bytes); required in production, optional elsewhere.
- `apps/api/test/helpers/test-env.ts` (modified) — a test key, also in `productionOverrides`; `playwright.config.ts` (modified) — `TOTP_ENCRYPTION_KEY` in `API_ENV`.
- `apps/api/src/identity/infrastructure/db/schema.ts` (modified) — tables `user_two_factor`, `recovery_codes`, `sign_in_challenges`; widened `auth_attempts` and `email_outbox` kind checks.
- `apps/api/drizzle/0005_two_factor.sql` (new, generated), `apps/api/drizzle/meta/_journal.json` (modified), `apps/api/drizzle/meta/0005_snapshot.json` (new, generated), `apps/api/drizzle/rollback/0005_two_factor.down.sql` (new; destructive, see Data model).
- Repositories in `apps/api/src/identity/infrastructure/db/`: `drizzle-two-factor-repository.ts`, `drizzle-recovery-code-repository.ts`, `drizzle-sign-in-challenge-repository.ts` (new; the challenge repository implements the purger port); `drizzle-unit-of-work.ts`, `drizzle-session-repository.ts` (modified).
- `apps/api/src/identity/infrastructure/email/email-worker.ts` (modified) — the retention purge also calls `SignInChallengePurger.purgeExpired`. Each purge runs in its own `try`, so a failed purge does not skip the others. `createEmailWorker` in `apps/api/src/identity/index.ts` wires it.
- `apps/api/src/identity/infrastructure/email/render-email.ts` and `apps/api/src/identity/infrastructure/email/messages/{es,en}.json` (modified) — the two notice emails, which carry no link or token.
- `apps/api/src/identity/index.ts` (modified) — wires the adapters. `IdentityInfrastructureDependencies.env` and `IdentityModuleDependencies.env` gain `TOTP_ENCRYPTION_KEY`, and the new ports are exported.
- Tests updated for the port changes (all in `apps/api/test/identity/` unless noted):
  - Type-level fakes and construction sites: `password-reset-use-cases.test.ts:172`, `register-user.test.ts:83`, `refresh-session.test.ts:110-116` (`work({...})` literals).
  - `EmailWorker` literals: `email-worker.test.ts:180`, `email-worker-resilience.test.ts:225`, `email-worker-resilience.test.ts:255`.
  - Env literals: `identity-infrastructure.test.ts:32, 52, 63`, `reset-session-races.test.ts:54-57`.
  - Migration and table lists: `migration.test.ts`, and `apps/api/test/deploy/build-output.test.ts:18-26`.
- New tests in `apps/api/test/identity/`: `totp.test.ts`, `secret-box.test.ts`, `recovery-code.test.ts`, `two-factor-persistence.test.ts`. The challenge purge test goes in `email-worker.test.ts`, and `apps/api/test/foundation/env.test.ts` is modified.

**Logic**
- TOTP (NFR-03): counter = floor(unix seconds / 30); HOTP with HMAC-SHA1 and dynamic truncation to 6 digits; `verify` checks counters c-1, c and c+1 with a constant-time comparison and returns the matching counter. The secret is 20 random bytes, base32 without padding.
- Setup and enable race: `savePending` is `insert … on conflict (user_id) do update set secret_sealed = excluded.secret_sealed … where user_two_factor.enabled_at is null returning 1`. `activate` is `update … set enabled_at = $3 where user_id = $1 and enabled_at is null and secret_sealed = $2 returning 1`. So a setup that runs between verifying and activating makes the enable fail (409) instead of activating a secret the user never confirmed.
- Replay: `advanceLastUsedStep` is `update user_two_factor set last_used_step = $2 where user_id = $1 and last_used_step < $2 returning 1`.
- Recovery codes: the generator yields 10 codes; hashes are computed before the transaction. Verification tries the user's unused codes one after another (never in parallel, so memory stays capped) and marks the match used atomically.
- Sign-in challenge: token of 32 random bytes (only its hash is stored), user id, the user's credentials version at the first factor, `via` (`password` | `google`), `language` for redirects, `attempts`, `expires_at = now + 5 min`.

**Data model**
- `user_two_factor`: `user_id uuid pk` fk `users` on delete cascade, `secret_sealed text not null`, `enabled_at timestamptz null` (null = pending setup), `last_used_step bigint not null default 0`, `created_at timestamptz not null default now()`.
- `recovery_codes`: `id uuid pk default random`, `user_id uuid not null` fk `users` on delete cascade, `code_hash text not null`, `used_at timestamptz null`, `created_at timestamptz not null default now()`; index on `user_id`.
- `sign_in_challenges`: `token_hash text pk`, `user_id uuid not null` fk `users` on delete cascade, `credentials_version integer not null`, `via text not null` check in (`password`, `google`), `language text not null` check in `LANGUAGES`, `attempts integer not null default 0`, `expires_at timestamptz not null`, `created_at timestamptz not null default now()`; index on `expires_at`; index on `user_id`.
- `auth_attempts_kind_check` gains `second_factor_user_15m` and `second_factor_user_24h`; `email_outbox_kind_check` gains `two_factor_enabled` and `two_factor_disabled`.
- Migration `0005_two_factor` only adds tables and widens checks (non-destructive). Its rollback is destructive and says so in its header, which also asks for the API and worker to be stopped first. It deletes the rows of the new kinds, restores the checks, and drops the three tables. Dropping `user_two_factor` turns 2FA off for every user.

**Input validation**
- No HTTP input in this block. `TOTP_ENCRYPTION_KEY` must decode from base64 to exactly 32 bytes.

**Error handling**
- A sealed value that fails authentication (tampered, wrong key, other user id) → `open` throws; callers treat it as an unexpected error (500), never as a wrong code.
- Missing key outside production → `SecretBoxUnavailable`, translated by the use cases of Blocks 2 and 3 into the `TwoFactorUnavailable` domain error (503).

**Required tests**
- [ ] TOTP matches the RFC 6238 Appendix B SHA-1 vectors (truncated to 6 digits) — validates NFR-03
- [ ] `verify` accepts the previous, current and next step and rejects two steps away — validates NFR-03, sad path
- [ ] `advanceLastUsedStep` accepts a later step once and refuses the same or an earlier step — sad path, validates NFR-03
- [ ] `otpauthUri` uses the issuer `Pesly` and percent-encodes an email with `+` — validates FR-01
- [ ] `seal`/`open` round-trips; a tampered value, another key, or another user id as associated data fails to open — sad path
- [ ] production env without `TOTP_ENCRYPTION_KEY`, or with a key that is not 32 bytes, fails to parse — sad path
- [ ] recovery codes: 10 distinct codes of the documented format; input with spaces, dashes, lower case, `I`, `L` or `O` normalizes to the stored form — validates FR-03
- [ ] `replaceAll` stores only Argon2id hashes (no plaintext in the table), and `markUsed` succeeds once per code — validates NFR-02, sad path
- [ ] `savePending` refuses when 2FA is enabled, and `activate` refuses when the pending secret changed — sad path
- [ ] `revokeAllForUserExcept` revokes every other session of the user and keeps the given one — validates FR-05
- [ ] a sign-in challenge is found while live, `consume` succeeds once, and an expired or consumed challenge is not found — sad path
- [ ] the retention purge deletes expired challenges, and a failing earlier purge does not skip it
- [ ] migration `0005` applies on `0004`, and its rollback restores `0004`

**Completion criterion**
All tests above pass; `drizzle-kit check` is clean; the existing suite still passes.

## Block 2 — Enrollment, disabling and notices

**Files**
- `packages/shared/src/auth/two-factor.ts` (new) — request and response schemas, including the shared code schemas; `packages/shared/src/index.ts` (modified).
- `packages/shared/src/errors.ts` (modified) — codes `TOTP_INVALID`, `TWO_FACTOR_ALREADY_ENABLED`, `TWO_FACTOR_NOT_ENABLED`, `TWO_FACTOR_SETUP_REQUIRED`, `TWO_FACTOR_UNAVAILABLE`, `SECOND_FACTOR_INVALID`, `SECOND_FACTOR_EXPIRED`.
- `apps/api/src/identity/domain/errors.ts` (modified) — the matching `AppError` subclasses (`TotpInvalid`, `TwoFactorAlreadyEnabled`, `TwoFactorNotEnabled`, `TwoFactorSetupRequired`, `TwoFactorUnavailable`, `SecondFactorInvalid`, `SecondFactorExpired`).
- `apps/api/src/shared/http/error-handler.ts` (modified) — `STATUS_BY_CODE` for the new codes.
- Use cases in `apps/api/src/identity/application/` (new): `get-two-factor-status.ts`, `start-two-factor-setup.ts`, `enable-two-factor.ts`, `disable-two-factor.ts`, and `second-factor-limits.ts`, which holds the two policies and a shared helper to check one code (TOTP or recovery), used by Block 3 as well.
- `apps/api/src/identity/infrastructure/http/two-factor-routes.ts` (new); `apps/api/src/identity/index.ts` (modified).
- `apps/api/test/identity/two-factor-enrollment.test.ts` (new).

**Logic**
- **Status:** `{ enabled, recoveryCodesRemaining }`.
- **Setup:** `savePending` with a freshly generated secret, sealed with the user id as associated data. If `savePending` returns false → 409 `TWO_FACTOR_ALREADY_ENABLED`. Returns the `otpauth://` URI and the base32 secret for manual entry.
- **Enable:**
  1. Requires a pending row.
  2. Verifies the code against the pending secret and advances `last_used_step`.
  3. Generates and hashes 10 recovery codes before opening the transaction.
  4. In one transaction:
     - `activate` with the verified sealed value (false → 409 `TWO_FACTOR_SETUP_REQUIRED`);
     - `recoveryCodes.replaceAll`;
     - `sessions.revokeAllForUserExcept(current session)`;
     - enqueue a `two_factor_enabled` outbox row.
  5. Returns the 10 plaintext codes once (AC-01, AC-02, AC-07).
- **Disable:**
  1. Requires 2FA enabled.
  2. Reserves the NFR-04 units, then checks the code (TOTP not replayed, or an unused recovery code) and records the NFR-01 unit on failure.
  3. On success, in one transaction:
     - delete `user_two_factor`, all recovery codes and the user's pending challenges;
     - `revokeAllForUserExcept(current session)`;
     - enqueue a `two_factor_disabled` outbox row;

     then give the units back (AC-03, AC-07).
  4. On failure keep them. When the limits refuse, give them back and answer 429; a failed refund is reported, never a 500.
- All four routes require a session and a verified email (`requireSession`, `requireVerifiedEmail`).
- Setup and enable answer with `Cache-Control: no-store`. No log line contains a code, secret, sealed value or recovery code.

**API contract**
- Method + path: `GET /auth/2fa`
- Request: none
- Response: 200 `{ enabled: boolean, recoveryCodesRemaining: number }`
- Error codes: 401 `UNAUTHENTICATED`, 403 `EMAIL_NOT_VERIFIED`
- Auth: session cookie; verified email

- Method + path: `POST /auth/2fa/setup`
- Request: `{}`
- Response: 200 `{ otpauthUri: string, secret: string }`, `Cache-Control: no-store`
- Error codes: 401 `UNAUTHENTICATED`, 403 `EMAIL_NOT_VERIFIED`, 409 `TWO_FACTOR_ALREADY_ENABLED`, 503 `TWO_FACTOR_UNAVAILABLE`
- Auth: session cookie; verified email; `Origin` guard

- Method + path: `POST /auth/2fa/enable`
- Request: `{ code: string }`
- Response: 200 `{ recoveryCodes: string[] }` (exactly 10), `Cache-Control: no-store`
- Error codes: 400 `VALIDATION_FAILED`, 400 `TOTP_INVALID`, 401 `UNAUTHENTICATED`, 403 `EMAIL_NOT_VERIFIED`, 409 `TWO_FACTOR_ALREADY_ENABLED`, 409 `TWO_FACTOR_SETUP_REQUIRED`, 503 `TWO_FACTOR_UNAVAILABLE`
- Auth: session cookie; verified email; `Origin` guard

- Method + path: `POST /auth/2fa/disable`
- Request: `{ code: string }` (a TOTP code or a recovery code)
- Response: 204
- Error codes: 400 `VALIDATION_FAILED`, 400 `TOTP_INVALID`, 401 `UNAUTHENTICATED`, 403 `EMAIL_NOT_VERIFIED`, 409 `TWO_FACTOR_NOT_ENABLED`, 429 `RATE_LIMITED`, 503 `TWO_FACTOR_UNAVAILABLE`
- Auth: session cookie; verified email; `Origin` guard

**Input validation**
- Enable `code`: exactly 6 ASCII digits after trimming spaces. Disable `code`: 6 digits, or a recovery code of 10 Crockford base32 characters with optional spaces and one dash (≤ 16 characters before normalization).

**Error handling**
- A wrong or replayed code, or an unknown or used recovery code → 400 `TOTP_INVALID`; nothing changes.
- Enable without setup, or with a secret replaced meanwhile → 409 `TWO_FACTOR_SETUP_REQUIRED`. Setup or enable when already enabled → 409 `TWO_FACTOR_ALREADY_ENABLED`. Disable when not enabled → 409 `TWO_FACTOR_NOT_ENABLED`.
- Missing key → 503 `TWO_FACTOR_UNAVAILABLE`.

**Required tests**
- [ ] setup returns an `otpauth://` URI and a secret with `Cache-Control: no-store`; enable with a valid code activates 2FA — validates AC-01
- [ ] enable returns 10 recovery codes once; the status afterwards returns only `recoveryCodesRemaining: 10`, and no endpoint returns the codes again — validates AC-02
- [ ] enabling ends every other session of the user (401 on their next use), keeps the current one, and enqueues a `two_factor_enabled` email — validates AC-07
- [ ] a setup running between an enable's verify and activate makes that enable answer 409, and 2FA stays off — sad path
- [ ] enable with a wrong code, a replayed code, or without setup is refused and 2FA stays off — sad path
- [ ] disable with a valid TOTP code turns 2FA off, deletes every recovery code, ends other sessions and enqueues a `two_factor_disabled` email — validates AC-03, AC-07
- [ ] disable with an unused recovery code turns 2FA off — validates AC-03
- [ ] disable with a wrong code is refused and counted; the 6th wrong code within 15 minutes answers 429 — sad path, validates NFR-04
- [ ] setup or enable when already enabled answers 409 — sad path
- [ ] a malformed code answers 400 `VALIDATION_FAILED` — sad path
- [ ] every route answers 401 without a session and 403 for an unverified email — sad path
- [ ] with no encryption key outside production, setup answers 503 `TWO_FACTOR_UNAVAILABLE` — sad path
- [ ] the notice emails render in `es` and `en`, and carry no link, token or code

**Completion criterion**
All tests above pass; enrollment works end to end against PostgreSQL.

## Block 3 — Second step of sign-in

**Files**
- `apps/api/src/identity/application/sign-in.ts` (modified) — a correct password for a user with 2FA returns `second_factor_required` with a new challenge instead of a session.
- `apps/api/src/identity/application/complete-google-sign-in.ts` (modified) — the same after Google, for users with 2FA enabled. A user created by this callback has no 2FA yet.
- `apps/api/src/identity/application/create-sign-in-challenge.ts`, `verify-second-factor.ts` (new).
- `apps/api/src/identity/infrastructure/http/session-routes.ts`, `google-routes.ts`, `two-factor-routes.ts`, `session-cookies.ts` (modified) — the last one adds `SIGN_IN_CHALLENGE_COOKIE`.
- `packages/shared/src/auth/sign-in.ts` (modified) — the sign-in response becomes a union: `{ status: "signed_in", user }` or `{ status: "second_factor_required" }`.
- `packages/shared/src/auth/google.ts` (modified) — `GOOGLE_SIGN_IN_ERRORS` becomes `SIGN_IN_ERRORS` with `google_failed` and `second_factor_expired`.
- Tests that break on the response union or on the new dependencies:
  - `apps/api/test/identity/auth-schemas.test.ts:114-115`
  - `apps/api/test/identity/sign-in.test.ts:57-59`
  - `apps/api/test/identity/sign-in-use-case.test.ts:102`, `apps/api/test/identity/reset-session-races.test.ts:128` (`new SignIn`)
  - `apps/api/test/identity/google-sign-in-races.test.ts:85` (`new CompleteGoogleSignIn`)
- `apps/api/test/identity/second-factor-sign-in.test.ts`, `second-factor-races.test.ts` (new); `apps/api/test/perf/second-factor.perf.test.ts` (new).

**Logic**
- **First factor passed and 2FA enabled:** create a challenge (Block 1) and set `__Secure-argent_mfa` (`HttpOnly; Secure; SameSite=Strict; Path=/auth/2fa; Max-Age=300`). No session is created.
  - Password: answer 200 `{ status: "second_factor_required" }`.
  - Google: answer 302 to `${WEB_BASE_URL}/{language}/sign-in/second-factor`. The cookie is set on the callback response, as the session cookies already are. Any Google link written before the challenge stays in place (see threat R-50).
- **Verify**, in this order:
  1. Reserve the NFR-04 units for the challenge's user. If refused, give them back and answer 429.
  2. In one unit of work, lock the live challenge. If it is missing or expired → 401 `SECOND_FACTOR_EXPIRED`.
  3. Increment its attempts. More than 5 → consume it and answer `SECOND_FACTOR_EXPIRED`.
  4. Check that the user's credentials version still equals the challenge's and that 2FA is still enabled. Otherwise consume it and answer `SECOND_FACTOR_EXPIRED`.
  5. Check the code: TOTP with the step advanced, or a recovery code marked used.
  6. On success: consume the challenge and start the session with `StartSession` for `{ id, credentialsVersion: challenge.credentialsVersion }`. After commit, give the NFR-04 units back, clear the challenge cookie and answer 200 `{ status: "signed_in", user }`.
  7. On failure: record the NFR-01 unit and answer 401 `SECOND_FACTOR_INVALID` (AC-05).
- A password reset does not disable 2FA. It invalidates pending challenges through the credentials version, and the next sign-in still asks for the second factor.

**API contract**
- Method + path: `POST /auth/sign-in` (modified)
- Request: unchanged `{ email, password }`
- Response: 200 `{ status: "signed_in", user }` with session cookies, or 200 `{ status: "second_factor_required" }` with `__Secure-argent_mfa`
- Error codes: unchanged (400, 401 `INVALID_CREDENTIALS`, 429)
- Auth: public; `Origin` guard

- Method + path: `GET /auth/google/callback` (modified)
- Request: unchanged
- Response: for a user with 2FA, 302 to `/{language}/sign-in/second-factor` with `__Secure-argent_mfa` and no session cookies; otherwise unchanged
- Error codes: unchanged
- Auth: unchanged

- Method + path: `POST /auth/2fa/verify`
- Request: `{ code: string }` plus cookie `__Secure-argent_mfa`
- Response: 200 `{ status: "signed_in", user }` with session cookies
- Error codes: 400 `VALIDATION_FAILED`, 401 `SECOND_FACTOR_INVALID`, 401 `SECOND_FACTOR_EXPIRED`, 429 `RATE_LIMITED`, 503 `TWO_FACTOR_UNAVAILABLE`
- Auth: challenge cookie; `Origin` guard

**Input validation**
- `code`: 6 ASCII digits, or a recovery code (the same shared schema as disable).

**Error handling**
- Wrong TOTP, replayed TOTP, unknown or used recovery code → 401 `SECOND_FACTOR_INVALID`, counted (AC-05, NFR-01, NFR-04).
- No cookie; an unknown, expired, consumed or over-attempted challenge; a credentials version that changed; 2FA turned off meanwhile → 401 `SECOND_FACTOR_EXPIRED`. The web app sends the user back to sign-in.
- Over the per-user limits → 429 `RATE_LIMITED`.
- No log line contains a code, the challenge token or a recovery code.

**Required tests**
- [ ] a password sign-in for a user with 2FA answers `second_factor_required`, sets the challenge cookie and creates no session; a valid TOTP code then starts the session — validates AC-04
- [ ] a Google sign-in for an existing user with 2FA redirects to the second-factor screen with the challenge cookie and no session; a valid code then starts the session — validates AC-06
- [ ] an unused recovery code starts the session once and is refused the second time; the unused count drops by one — validates AC-04, AC-05
- [ ] a wrong TOTP code and a used recovery code are refused with `SECOND_FACTOR_INVALID` and recorded on `sign_in_account`: after 3 wrong codes, 2 wrong passwords make the next password attempt answer 429 — validates AC-05, NFR-01
- [ ] 5 wrong passwords (account locked for passwords) do not block a valid second factor on an existing challenge — validates NFR-04
- [ ] the 6th wrong code within 15 minutes and the 21st within 24 hours answer 429, and a refused attempt gives its units back — sad path, validates NFR-04
- [ ] a TOTP code already used for a sign-in is refused on the next challenge — sad path, validates NFR-03
- [ ] verify without the cookie, with an expired challenge, after 5 attempts on one challenge, or with a consumed challenge answers `SECOND_FACTOR_EXPIRED` — sad path
- [ ] a password reset between the first and second factor, or 2FA disabled meanwhile, makes verify answer `SECOND_FACTOR_EXPIRED` without spending the code — sad path
- [ ] two concurrent verifies with the same valid code, or one with a TOTP code and one with a recovery code, start exactly one session and spend at most one code — sad path
- [ ] users without 2FA still sign in in one step with password and with Google — regression
- [ ] a code that is neither 6 digits nor a recovery code answers 400 `VALIDATION_FAILED` — sad path
- [ ] perf: verify with a recovery code (10 unused codes) p95 < 1000 ms over 50 requests — validates NFR-02 cost budget

**Completion criterion**
All tests above pass; the DISC-001-01a and DISC-001-01b suites pass with the new sign-in response.

## Block 4 — Web: security settings and second-factor screen

**Files**
- Security settings:
  - `apps/web/src/app/[locale]/(app)/settings/security/page.tsx` (new).
  - `apps/web/src/features/two-factor/containers/security-settings-container.tsx` (new). It builds the QR from the `otpauth://` URI with `qrcode`.
  - Presentational components in `apps/web/src/features/two-factor/components/` (new): `two-factor-status.tsx`; `two-factor-setup.tsx` (QR image, manual secret, code input); `recovery-codes.tsx` (shown once, with copy and download as text); `disable-two-factor.tsx` (TOTP or recovery code).
- Second-factor sign-in:
  - `apps/web/src/app/[locale]/(auth)/sign-in/second-factor/page.tsx` (new).
  - `apps/web/src/features/auth/containers/second-factor-container.tsx` and `apps/web/src/features/auth/components/second-factor-form.tsx` (new): a TOTP input with a "use a recovery code" switch.
- Existing files modified:
  - `apps/web/src/features/auth/containers/sign-in-container.tsx` — on `second_factor_required` it navigates to the second-factor screen, and it shows `second_factor_expired` from `SIGN_IN_ERRORS`.
  - `apps/web/src/features/auth/components/authenticated-shell.tsx` — adds a link to security settings.
  - `apps/web/src/lib/api-client.ts` — the new endpoints. Settings calls use `refreshOnUnauthenticated: true` and verify does not. `MESSAGE_KEY_BY_CODE` gains every new code.
  - `apps/web/src/features/auth/form-errors.ts`.
  - `apps/web/messages/es.json` and `apps/web/messages/en.json`.
  - `apps/web/package.json` and `pnpm-lock.yaml` — add `qrcode` and `@types/qrcode`.
- Tests:
  - New e2e: `apps/web/e2e/two-factor.spec.ts`, and `apps/web/e2e/support/totp.ts`, which computes codes from the secret shown on screen.
  - New web tests in `apps/web/test/` for every new component and container.
  - Web tests to modify: `apps/web/test/sign-in-container.test.tsx` (the `signedIn()` stub gains `status`), `apps/web/test/routes.test.tsx` (the new pages), `apps/web/test/api-client.test.ts` (the new client methods), and `apps/web/test/auth-components.test.tsx` (the settings link).

**Logic**
- **Settings:**
  - The container loads `GET /auth/2fa`.
  - "Enable" calls setup and shows the QR and the secret. The user types a code.
  - On success the recovery codes are shown once, with an explicit "I saved them" step. Leaving the page never shows them again.
  - "Disable" asks for a TOTP or recovery code.
- **Sign-in:**
  - `second_factor_required` → `/{locale}/sign-in/second-factor`. The form posts the code.
  - `SECOND_FACTOR_EXPIRED` navigates to `/{locale}/sign-in?error=second_factor_expired`.
- **Split:** presentational components are pure; containers call the API.

**API contract**
- No new endpoint. The screens call:
  - `GET /auth/2fa`, `POST /auth/2fa/setup`, `POST /auth/2fa/enable` and `POST /auth/2fa/disable` (Block 2);
  - `POST /auth/sign-in` and `POST /auth/2fa/verify` (Block 3).
- Request and response bodies: the shared schemas in `@argent/shared`.
- Error codes: `TOTP_INVALID`, `SECOND_FACTOR_INVALID`, `SECOND_FACTOR_EXPIRED`, `TWO_FACTOR_*`, `RATE_LIMITED`, mapped to message keys.
- Auth:
  - The settings screen uses the session cookie; the second-factor screen uses the challenge cookie.
  - `credentials: 'include'` and `X-Requested-With: argent`, as in DISC-001-01a.

**Input validation**
- Client-side mirrors of the shared code schemas; the API remains the authority.

**Error handling**
- `TOTP_INVALID` / `SECOND_FACTOR_INVALID` — an invalid-code message; the input stays focused.
- `SECOND_FACTOR_EXPIRED` — back to sign-in with an expired-sign-in message.
- `RATE_LIMITED` and `TWO_FACTOR_UNAVAILABLE` — a retry-later message.

**Required tests**
- [ ] e2e: enable 2FA from settings (QR and secret shown, code computed from the secret); 10 recovery codes shown once and absent after reload — validates AC-01, AC-02
- [ ] e2e: a second browser context signed in to the same account is signed out after 2FA is enabled — validates AC-07
- [ ] e2e: sign out, then sign in with a password: the second-factor screen appears and a valid code enters the app — validates AC-04
- [ ] e2e: a wrong code shows the invalid-code message; a recovery code enters once and fails the second time — validates AC-05
- [ ] e2e: Google sign-in for a user with 2FA goes through the second-factor screen — validates AC-06
- [ ] e2e: disable 2FA with a recovery code; the next sign-in has one step — validates AC-03
- [ ] component: recovery codes render, copy and download; the setup form rejects a non-numeric code before sending — sad path
- [ ] component: `SECOND_FACTOR_EXPIRED` sends the user back to sign-in with the message — sad path
- [ ] component: every new screen renders in `/es` and `/en` with no missing keys

**Completion criterion**
All e2e tests pass in CI; the coverage floor holds with the new components.

## Final verification
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (80% lines, branches and functions), `pnpm test:perf` and `pnpm e2e` pass.
- Every FR-01..FR-05, NFR-01..NFR-04 and AC-01..AC-07 maps to a passing test above.
- A database dump contains no TOTP secret in the clear, no recovery code in the clear and no challenge token.

## Decision log
- 2026-09-30: PRD FR-04/AC-06 (user decision): 2FA is asked after any first factor, password or Google.
- 2026-09-30: PRD corrective loop (user decisions after the architecture review): per-user second-factor limit that wrong passwords cannot exhaust (NFR-04); recovery code can disable (AC-03); enable and disable end other sessions and email a notice (FR-05, AC-07). Authenticator issuer "Pesly", the production brand of `pesly.com.ar`.
- 2026-09-30: The TOTP secret is encrypted with AES-256-GCM under `TOTP_ENCRYPTION_KEY`, not hashed, because verification needs the secret. The user id is authenticated data, so a sealed value cannot be moved to another user. The `keyId` in the format allows a future rotation that re-seals every secret (recorded for the identity hardening ticket). Without the key outside production, 2FA answers 503 instead of storing secrets unprotected.
- 2026-09-30: TOTP is implemented in-house on `node:crypto` (about 40 lines, verified against the RFC 6238 vectors) instead of adding a runtime dependency to the API.
- 2026-09-30: The sign-in challenge lives in PostgreSQL behind a `SameSite=Strict` cookie scoped to `/auth/2fa`, so any API instance can finish a sign-in and the challenge is single-use (stateless API, DISC-001-01a NFR-09).
- 2026-09-30: A password reset does not turn 2FA off: resetting proves control of the email, which is the first factor, not the second. It still invalidates pending challenges.
- 2026-09-30: Architecture review and impact scan applied: conditional `savePending`/`activate` against the setup race; verify ordered and locked in one unit of work; the session uses the challenge's credentials version; recovery-code hashing outside transactions and sequential checks; a `RecoveryCodeGenerator` port and a `SignInChallengePurger` port; domain error classes; `no-store` on secret-bearing responses; client refresh flags; `SIGN_IN_ERRORS`; every breaking test and construction site listed.
