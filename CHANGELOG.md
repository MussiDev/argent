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
- DISC-001-01d Profile screen and API (`GET` and `PATCH /profile`): display name, read-only email
  and 2FA status, plus editable default rate type, display currency, time zone (validated against
  the IANA database) and interface language; changing the language moves to the matching locale
  route. Migration `0007_profile_display_name` adds a nullable display name; existing accounts keep
  none until the user sets one.
- DISC-001-01d Shared integer-only amount formatter that follows the interface language (`1,557.30`
  in English, `1.557,30` in Spanish).
- DISC-001-02a Accounts: create, rename, archive, unarchive and delete accounts (cash, bank
  account, digital wallet, credit card, savings) in ARS or USD, with the currency and the type fixed
  at creation, unique names per user and 404 for anything that is not the user's. The list shows
  each balance and one total per currency, computed exactly, and screens in Spanish and English
  reach it from the home page. Migration `0006_accounts` adds the `accounts` table; the opening
  balance is optional, may be negative and is limited to 10^13 major units. Balances read their
  movements through a port, so they equal the opening balance until PRD 03 supplies movements, and
  an account that has movements cannot be deleted. Names refuse control, zero-width and
  bidirectional characters.
- DISC-001-02a Shared integer-only money helpers: exact sums, locale-aware formatting and parsing
  of amounts, and amounts that travel as decimal strings.
- FEAT-002 The product is named Pesly everywhere a user sees it: the web title and PWA name, the
  screens, the recovery codes file and every email, in Spanish and English. The workspace packages
  are `@pesly/*`, and Railway builds the services by path, so a package rename cannot break a
  deploy. No user is signed out: cookie names and token claims are unchanged.
- DISC-001-01e Display name at sign-up: the registration screen and `POST /auth/register` require a
  name (1 to 50 characters, no NUL character), stored on the new account and shown in the profile;
  registering an already registered email still answers exactly as before and never touches the
  existing account. A Google sign-up takes the name from the Google profile (`profile` scope; a
  missing or empty name gives none, a longer one is cut to 50 characters), and a Google sign-in that
  takes over an unverified password account replaces the name typed at registration; linking a
  verified account or signing in again never changes it. No migration.
- DISC-001-02b Categories: each user has expense and income categories with one level of
  subcategories, created with a name, icon and color, renamed, archived (a parent takes its
  subcategories with it), unarchived and deleted while unused. Names are unique per kind and parent
  regardless of case, and an untouched default also blocks its name in the other language.
- DISC-001-02b Default categories: 33 defaults (9 expense, 5 income, 19 subcategories) are created
  with every new account, including Google sign-up, in the same transaction, and by migration
  0009 for existing users; a deleted default is never recreated. Defaults show in the interface
  language until renamed, then keep the name the user gave.
- DISC-001-02b Categories screen in Spanish and English and the `categories` REST routes; the
  `categories` module keeps the identity module free of any dependency on it. Migration 0009
  adds two tables and a guard trigger; its rollback script is destructive. Deferred to PRD 03:
  showing and keeping categories on movements, and blocking deletion of a category in use by a
  movement.
- DISC-001-01f Account deletion: a signed-in user deletes the account and all its data from a new
  screen (`/settings/delete-account`) after re-authenticating: the password (plus a TOTP or recovery
  code when two-factor authentication is on), or, for an account created with Google and no password,
  a fresh Google sign-in that issues a single-use grant (5 minutes, bound to the session). Deletion
  ends every session, removes the pending emails of the user and cascades to every user-owned table;
  a guard test fails when a new table that references a user is not registered for erasure. New
  migration `0010_account_deletion` (OAuth state purpose and `deletion_grants`); `GET /profile` gains
  a required `deletionReauth`, so the API deploys first.
- FEAT-003 Available balance vs net worth: every account has an "include in available" setting
  (cash, bank account and digital wallet start included; savings and credit cards do not, and a
  credit card can never be included), changeable on active non-card accounts through
  `PUT /accounts/:id/include-in-available` (credit card: 400 naming the field; archived: 409
  `ACCOUNT_ARCHIVED`). The account list headline shows Available per currency prominently and Net
  worth (all active accounts, card debt included) smaller, and credit cards move to their own Debt
  section with a per-currency total; the list response replaces `totals` with `availableTotals`,
  `netWorthTotals`, `debtTotals` and `creditCardCount`. Migration 0011 backfills existing accounts
  by type default.
- DISC-001-03a Exchange rates, store and sync: the worker refreshes the buy and sell prices of the
  seven ARS/USD rate types (oficial, blue, MEP, CCL, mayorista, cripto, tarjeta) from dolarapi.com
  every 60 minutes and keeps the last stored set when the provider fails (a failed refresh is
  recorded and retried after 5 minutes); `GET /exchange-rates/latest` returns the stored rates to a
  verified user. Rates are integers scaled by 10,000 end to end and the API never calls the provider.
  New settings `RATE_PROVIDER` (`dolarapi` or `fake`) and `DOLARAPI_BASE_URL`, both with defaults
  and pinned in production. Migration `0012_exchange_rates`.

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
