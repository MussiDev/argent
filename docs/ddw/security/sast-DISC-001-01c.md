# SAST report DISC-001-01c: Two-Factor Authentication

| Field | Value |
|---|---|
| Ticket | DISC-001-01c |
| Tier | FEATURE |
| Date | 2026-09-30 |
| Scope | `git diff --ignore-cr-at-eol origin/main...HEAD`: `apps/api/src/identity/**` (TOTP engine, secret box, recovery codes, repositories, enrollment, disable, second-factor verify, sign-in and Google changes, routes, worker notices, migration `0005` and rollback), `apps/api/src/shared/**` (env, logger, error handler), `packages/shared/src/auth/{sign-in,two-factor,google}.ts`, `apps/web/src/**` (security settings, second-factor screen, api client), `pnpm-lock.yaml`, tests and fixtures for secrets only |
| Method | Manual review by `ddw-sec-auditor` against catalog §4, plus `pnpm audit --prod` and `pnpm audit` |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 1 Low and 8 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): AES keys exist only in test code (`apps/api/test/helpers/test-env.ts:16`, `playwright.config.ts:33`) and the `JBSWY3DP…` TOTP secrets are fixtures in `apps/web/test/*` — false positives; nothing under `src` imports them; production requires `TOTP_ENCRYPTION_KEY` (`apps/api/src/shared/config/env.ts:85`) as 32 bytes of base64 (`env.ts:132`).
- ✅ F-SAST-02 SQL injection (CWE-89): Drizzle builder only (`apps/api/src/identity/infrastructure/db/drizzle-two-factor-repository.ts:12`, `drizzle-sign-in-challenge-repository.ts:19`, `drizzle-recovery-code-repository.ts:12`, `drizzle-user-repository.ts:79`); `sql` templates reference columns only; migration `0005` and its rollback are static.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the diff.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): the sealed format is parsed strictly — version, keyId, exactly 5 parts, 12-byte IV, 16-byte tag (`apps/api/src/identity/infrastructure/security/aes-gcm-secret-box.ts:55`, `:69`) — and authenticated by GCM; no new `JSON.parse` in `src`.
- ✅ F-SAST-05 Path traversal (CWE-22): no filesystem access in the diff.
- ✅ F-SAST-06 XSS (CWE-79): QR is a locally generated SVG shown as `<img>` (`apps/web/src/features/two-factor/containers/security-settings-container.tsx:42`, `apps/web/src/features/two-factor/components/two-factor-setup.tsx:56`); codes and secret are React text nodes (`recovery-codes.tsx:52`); download is an encoded `data:text/plain` URL (`recovery-codes.tsx:37`); notice emails are static catalog text through `escapeHtml`; `?error=` is allowlisted (`apps/web/src/features/auth/containers/sign-in-container.tsx:21`).
- ✅ F-SAST-07 SSRF (CWE-918): no new outbound requests; the second-factor redirect is built from `WEB_BASE_URL` and a stored language enum (`apps/api/src/identity/infrastructure/http/google-routes.ts:79`).
- ✅ F-SAST-08 Broken cryptography (CWE-327): RFC 6238/4226 TOTP with HMAC-SHA1 (allowed by the RFC), 160-bit secret, ±1 step, `timingSafeEqual` on every step (`apps/api/src/identity/infrastructure/security/totp.ts:47`, `:68`); AES-256-GCM with random 96-bit IV, user id as AAD, 16-byte tag (`aes-gcm-secret-box.ts:42`, `:44`, `:69`); 50-bit recovery codes from `randomBytes` hashed with Argon2id (`crypto-recovery-code-generator.ts:11`, `apps/api/src/identity/application/enable-two-factor.ts:76`); 256-bit challenge token stored as SHA-256 (`create-sign-in-challenge.ts:30`).
- ✅ F-SAST-09 Debug mode in production (CWE-489): `UnavailableSecretBox` only outside production; production refuses to start without the key (`env.ts:85`); sign-in never opens the secret, so a missing key cannot let a login through.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): 2FA routes log only ids, ip, `via` and `reason` (`apps/api/src/identity/infrastructure/http/two-factor-routes.ts:78`, `:148`); redaction adds `secret`, `otpauthUri`, `recoveryCodes`, `body.code`, `query.code` (`apps/api/src/shared/logging/logger.ts:28`, `:43`).
- ✅ F-SAST-11 Unrestricted upload (CWE-434): not applicable.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): challenge cookie `__Secure-argent_mfa` is `HttpOnly; Secure; SameSite=Strict; Path=/auth/2fa`, 5 minutes (`apps/api/src/identity/infrastructure/http/session-cookies.ts:34`); the global Origin + `X-Requested-With` guard covers every POST (`apps/api/src/shared/http/origin-guard.ts:12`, `apps/api/src/app.ts:120`).
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod` and `pnpm audit` — "No known vulnerabilities found".
- ✅ F-SAST-14 Incomplete input validation (CWE-20): 6-digit and Crockford recovery-code schemas (`packages/shared/src/auth/two-factor.ts:15`, `:27`); every 2FA route validated (`two-factor-routes.ts:73`, `:91`, `:115`, `:140`); ASCII-only normalization (`apps/api/src/identity/domain/recovery-code.ts:20`); DB checks on `via` and `language` (`apps/api/drizzle/0005_two_factor.sql:18`).
- ✅ F-SAST-15 Insecure error handling (CWE-209): an unopenable secret becomes 500 `INTERNAL`, never a wrong code (`apps/api/src/identity/application/second-factor-limits.ts:102`); every expired reason answers the same 401; `second_factor_required` exposes no user data (R-48).
- ✅ F-SAST-16 Medium CVE in a dependency: none; new transitive packages of `qrcode` are past their fixed versions.
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function`, `dangerouslySetInnerHTML`, `innerHTML` or `Math.random` in the diff.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Second-factor bypass review

No path gives a session without the second factor to a user with 2FA enabled: password (`apps/api/src/identity/application/sign-in.ts:102`), Google (`complete-google-sign-in.ts:123`), refresh (keeps the session's credentials version, `refresh-session.ts:57`), reset (starts no session and invalidates pending challenges), disable (needs a valid code). Every traced race (enable vs sign-in, disable vs verify, reset vs verify) ends at most in a session already stale by its credentials version.

## Low and informational findings (W-SAST-01)

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| L-1 | Low (CWE-306) | `apps/api/src/identity/application/enable-two-factor.ts:58` | Enable needs only a session, not a recent re-authentication; a stolen session can enroll its own authenticator and lock the owner out (recovery for that case is out of the PRD's scope) | Deferred to the identity hardening ticket (re-authenticate before setup and enable; notice wording pointing to support); recorded in threat R-46 |
| I-1 | Info | `apps/api/src/identity/application/attempt-policies.ts:22` | Disable's separate keys give someone holding the password and a session 40 guesses a day, not 20 | Threat R-40 reworded (about 0.012% a day) |
| I-2 | Info | `apps/api/src/identity/application/disable-two-factor.ts:80` | The code is spent before the disable transaction; a transaction failure burns it while 2FA stays on | Accepted: fail-safe, other codes remain |
| I-3 | Info | `apps/api/src/identity/application/disable-two-factor.ts:94` | Wrong disable codes count on `sign_in_account`, so a stolen session can trigger the 15-minute password lockout | Accepted: required by NFR-01; same class as R-23/R-51 |
| I-4 | Info | `apps/api/src/identity/infrastructure/security/aes-gcm-secret-box.ts:38` | `keyId` stores 32 bits of SHA-256(key) | Accepted; HMAC derivation when rotation lands |
| I-5 | Info | `playwright.config.ts:33` | Production accepts any well-formed key, including the public test keys | Hardening ticket: production denylist in `env.ts` |
| I-6 | Info | `apps/api/drizzle/rollback/0005_two_factor.down.sql:1` | Destructive rollback turns 2FA off for everyone | Accepted: documented plan (R-47, AGENTS.md) |
| I-7 | Info | `pnpm-lock.yaml:5292` | `qrcode` pulls CLI-only packages (`yargs`, `pngjs`) | Accepted: audit clean, not in the browser path |
| I-8 | Info | `apps/api/src/identity/application/complete-google-sign-in.ts:121` | A Google link written before the second factor stays if it fails | Accepted: R-50 |

## Summary

Total: 17 categories clean, 0 vulnerabilities open (0 critical, 0 high, 0 medium); 1 Low deferred to
the identity hardening ticket and 8 Info documented.
