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

### Fixed

- FIX-001 A refresh that races a sign-out, sign-out-all or password reset is rejected without
  being logged as refresh token reuse or revoking the session family.
- FIX-001 A rate-limited sign-in answers 429 even when refunding its reserved attempts fails.
- FIX-002 Railway deployment: one config per service (API, email worker, web), the API bundled
  with esbuild to run on plain `node`, migrations as a pre-deploy step, the web listening on
  `PORT`, and every start command capping the V8 heap (320 MB API and web, 192 MB worker).
