# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- DISC-001-01a Monorepo foundation: pnpm workspaces with `apps/web` (Next.js 16, next-intl es/en,
  Tailwind, shadcn/ui), `apps/api` (Express 5, hexagonal) and `packages/shared` (Zod schemas),
  PostgreSQL with Drizzle migrations, Vitest, Playwright, ESLint and CI.
- DISC-001-01a Email and password registration with Argon2id hashing, breached-password check
  (HIBP k-anonymity) and email verification through a transactional outbox with retries.
- DISC-001-01a Sign-in with short-lived access tokens and rotating refresh tokens in secure
  cookies, sign-out and sign-out from all devices, with per-account and per-IP attempt limits.
- DISC-001-01a Password reset by email that revokes every existing session.
- DISC-001-01a Access control: data scoped by owner or group membership, answering 404 for
  anything that is not the user's; unverified accounts blocked from data.
- DISC-001-01a Web authentication screens (register, verify, sign in, forgot and reset password)
  in Spanish and English, with time zone and language defaults from the device.
- DISC-001-01b Google sign-in through the OpenID Connect authorization code flow with PKCE, run by
  the API with single-use OAuth states bound to the browser; no Google script in the web app.
- DISC-001-01b Accounts created with Google start verified and without a password; a Google
  account links to an existing account only when Google is authoritative for the email (Gmail or
  Workspace), and an unverified password account with that email is taken over (password and
  sessions removed) to prevent account pre-hijacking.
- DISC-001-01b "Continue with Google" on the sign-in and register screens, in Spanish and English.
- FEAT-001 The Railway services are defined as Infrastructure as Code in `.railway/railway.ts`, a
  partial that owns only `argent-api`, `argent-worker`, `argent-web` and `argent-postgres`;
  secrets stay in Railway, and a test fails if one is given a value. `pnpm railway:plan` and
  `pnpm railway:apply` run Railway's CLI on Windows, Linux and macOS. The deprecated
  `railway.json` files are removed, and restart retries go from 10 to 5.
- DISC-001-01c Optional two-factor authentication with an authenticator app (TOTP, RFC 6238):
  enrollment from a new security settings screen with a QR code, 10 one-time recovery codes shown
  once and stored only as Argon2id hashes, and disabling with a code or a recovery code.
- DISC-001-01c A second step after any sign-in (password or Google) for users with 2FA, through a
  short-lived single-use challenge; failed codes count toward the sign-in limit and are also
  limited per user, so a known email cannot lock its owner out of the second step.
- DISC-001-01c Enabling or disabling 2FA ends every other session and emails the owner a notice.

### Fixed

- FIX-001 A refresh that races a sign-out, sign-out-all or password reset is rejected without
  being logged as refresh token reuse or revoking the session family.
- FIX-001 A rate-limited sign-in answers 429 even when refunding its reserved attempts fails.
- FIX-002 Railway deployment: one config per service (API, email worker, web), the API bundled
  with esbuild to run on plain `node`, migrations as a pre-deploy step, the web listening on
  `PORT`, and every start command capping the V8 heap (320 MB API and web, 192 MB worker).
- FIX-003 The email worker validates only the seven settings it reads, so API-only settings (the
  JWT secret, the Google client) can no longer stop it and are no longer handed to it.
- FIX-004 Google sign-ins finishing at the same time for the same new account (a double click, two
  tabs) all sign in, instead of one of them showing "Google sign-in failed".
- FIX-005 The email worker and the web run with container limits on Railway (1 vCPU each; 512 MB
  and 1 GB), so a runaway can no longer grow to the plan maximum. The TOTP encryption key is
  declared as preserved in `.railway/railway.ts`, so applying the definition never deletes it.
