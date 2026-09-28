# Spec DISC-001-01a: Email & Password Authentication

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01a |
| PRD | docs/ddw/prd/prd-DISC-001-01a.md |
| Tier | FEATURE |
| Date | 2026-09-26 |
| Spec loops | 7 |
| Loops since last human decision | 1 |

## Summary
First code in the repository. Block 1 lays the pnpm monorepo declared in `AGENTS.md` (Next.js 16
web app, Express 5 API, shared Zod package, PostgreSQL + Drizzle, Vitest, Playwright, CI). Blocks
2–6 build the `identity` module of the API in hexagonal layers: pure domain rules, use cases and
ports in `application/`, and Drizzle repositories, security adapters, an email outbox and HTTP
routes in `infrastructure/`. Sessions are a short-lived signed JWT plus a rotating opaque refresh
token, both in host-only cookies; every piece of state (sessions, one-time tokens, rate-limit
counters, outbox) lives in PostgreSQL so any API instance can serve any request. Block 7 adds the
bilingual auth screens in the web app.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 2, Block 3, Block 7 |
| FR-02 | Block 3, Block 6, Block 7 |
| FR-03 | Block 4, Block 7 |
| FR-04 | Block 5, Block 7 |
| FR-05 | Block 4, Block 7 |
| FR-06 | Block 4 |
| FR-07 | Block 6 |
| FR-08 | Block 6 |
| FR-09 | Block 2, Block 3 |
| FR-10 | Block 2, Block 3, Block 7 |
| FR-11 | Block 2, Block 3, Block 7 |
| NFR-01 | Strategy: `Argon2idPasswordHasher` with m=19456 KiB, t=2, p=1 (Block 2); a logger redaction list removes `password`, `newPassword`, `token` and cookies from every log line (Block 1); unit test asserts parameters and that no log line contains the submitted password. |
| NFR-02 | Strategy: pure `passwordLengthRule` (≥ 10) in the domain plus the `BreachedPasswordChecker` port with the HIBP range adapter (Block 2), applied by the register and reset use cases. Fail-closed: if HIBP does not answer within 400 ms or errors, the request is rejected with `PASSWORD_CHECK_UNAVAILABLE` and nothing is created, so no password bypasses the check. |
| NFR-03 | Strategy: `AttemptLimiter` port with a PostgreSQL adapter (`auth_attempts`, fixed windows), keyed by normalized submitted email and by client IP (Express `trust proxy` configured) — 5/account and 20/IP per 15 min for sign-in failures, 5 registrations/IP per hour (Block 4, Block 3). Checked before any Argon2id work. |
| NFR-04 | Strategy: one-time tokens of 256 random bits, stored as SHA-256, with `expires_at` (24 h verification, 60 min reset) and `used_at` set atomically on consumption (Block 2, Block 3, Block 5). |
| NFR-05 | Strategy: access JWT (HS256, 15 min) in `__Host-argent_at` (Path=/); refresh token in `__Secure-argent_rt` (Path=/auth), both `HttpOnly; Secure; SameSite=Strict`, host-only; refresh rotates on every use; `sessions.last_used_at` gives a 30-day sliding inactivity limit (Block 4). |
| NFR-06 | Strategy: no network call to the email provider in the request path (outbox, Block 3); HIBP timeout 400 ms; indexed lookups; a benchmark test with autocannon on sign-in and registration asserts p95 < 500 ms against the test database (Block 4). |
| NFR-07 | Strategy: TLS terminated at the hosting edge with HTTP→HTTPS redirect (deployment config); the API sends `Strict-Transport-Security` via helmet and, when `NODE_ENV=production`, rejects requests whose `X-Forwarded-Proto` is not `https` (Block 1). |
| NFR-08 | Strategy: identical status and body for existing and unknown emails; a fixed dummy Argon2id hash verified when the email is unknown; both paths insert one outbox row (a `discard` row for unknown emails) so the work done is the same (Block 3, Block 4, Block 5); a timing test asserts median difference < 50 ms over 200 requests. |
| NFR-09 | Strategy: no in-memory state — signing secret from env, sessions/tokens/limits/outbox in PostgreSQL; an integration test starts 2 API instances and uses a session created on instance A against instance B (Block 4). |
| NFR-10 | Strategy: next-intl with `messages/es.json` and `messages/en.json` (Block 1, Block 7); API returns error codes only; email copy in `identity/infrastructure/email/messages/{es,en}.json` (Block 3); a test fails if a key exists in one catalog and not the other; dates/amounts formatted with `Intl` for `es-AR` / `en-US`. |
| NFR-11 | Strategy: web and API deployed on the same registrable domain (`WEB_ORIGIN`, `API_ORIGIN` env); cookies are host-only on the API (not `Domain=`-scoped) and sent because requests are same-site; credentialed CORS restricted to `WEB_ORIGIN` (Block 1, Block 4). |

## Dependencies between blocks
Block 1 → Block 2 → Block 3 → Block 4 → Block 5 → Block 6 → Block 7. Block 5 and Block 6 depend
on Block 4 (sessions); Block 7 depends on Blocks 3–6 (API endpoints). Block 8 depends on Block 3
(email worker) and is independent of Blocks 4–7. Execution order: 1, 2, 3, 4, 5, 6, 7, 8.

## Justified new dependencies
- `express@5` — HTTP framework chosen in `AGENTS.md`; v5 routes rejected promises to the error middleware.
- `zod` — request/response validation and typing shared by API and web (`AGENTS.md`).
- `drizzle-orm`, `drizzle-kit`, `pg` — ORM, migrations and PostgreSQL driver declared in `AGENTS.md`.
- `@node-rs/argon2` — Argon2id with native bindings, required by NFR-01 and fast enough for NFR-06.
- `jose` — standards-compliant JWT signing/verification with explicit algorithm pinning (R-14).
- `cookie-parser` — reads the session cookies.
- `helmet` — security headers including HSTS (NFR-07) and CSP defaults.
- `cors` — credentialed cross-origin requests from `WEB_ORIGIN` only (web and API are separate origins).
- `resend` — production email adapter behind the `EmailSender` port.
- `pino` — structured logging with path redaction (NFR-01, repudiation controls in the threat model).
- `next@16`, `react`, `react-dom`, `tailwindcss`, `lucide-react`, `next-intl`, `class-variance-authority`, `clsx`, `tailwind-merge` — web stack declared in `AGENTS.md` (shadcn/ui peer utilities).
- Dev: `typescript`, `vitest`, `supertest`, `@playwright/test`, `autocannon`, `eslint`, `typescript-eslint`, `prettier`, `tsx`.

## Block 1 — Monorepo foundation

**Files**
- `package.json` (new) — workspace root, `packageManager: pnpm@11`, `engines.node: >=24`, scripts `lint`, `typecheck`, `test`, `e2e`, `db:migrate`.
- `pnpm-workspace.yaml` (new) — `apps/*`, `packages/*`.
- `.nvmrc` (new) — `24`.
- `tsconfig.base.json` (new) — `strict: true`, `noUncheckedIndexedAccess: true`.
- `eslint.config.mjs` (new) — typescript-eslint strict, `no-explicit-any` as error, import boundary rule forbidding `identity/domain` → `infrastructure` imports.
- `.prettierrc` (new) — formatting config.
- `vitest.config.ts` (new) — `projects: ['apps/api', 'packages/shared', 'apps/web']`.
- `docker-compose.yml` (new) — PostgreSQL 16 (host port 5434, to avoid clashing with other local PostgreSQL containers) and Mailpit for local development.
- `.env.example` (new) — `DATABASE_URL`, `JWT_SECRET`, `WEB_ORIGIN`, `API_ORIGIN`, `WEB_BASE_URL`, `EMAIL_PROVIDER` (`console|mailpit|resend`), `RESEND_API_KEY`, `BREACH_CHECKER` (`hibp|fake`), `TRUST_PROXY`.
- `.gitignore` (modified) — add `node_modules/`, `.next/`, `dist/`, `.env*` (except `.env.example`), `coverage/`, `playwright-report/`, `test-results/`.
- `.github/workflows/ci.yml` (new) — jobs: install (`--frozen-lockfile`), lint, typecheck, unit/integration tests with a PostgreSQL service, Playwright e2e.
- `packages/shared/package.json` (new) — `@argent/shared`, `exports` pointing at `src/index.ts` (consumed as TS source by both apps; no build step).
- `packages/shared/tsconfig.json` (new).
- `packages/shared/src/index.ts` (new) — barrel.
- `packages/shared/src/errors.ts` (new) — error code union (`VALIDATION_FAILED`, `UNAUTHENTICATED`, `EMAIL_NOT_VERIFIED`, `NOT_FOUND`, `RATE_LIMITED`, `PASSWORD_TOO_SHORT`, `PASSWORD_BREACHED`, `PASSWORD_CHECK_UNAVAILABLE`, `TOKEN_INVALID`, `INVALID_CREDENTIALS`, `INTERNAL`).
- `packages/shared/src/rate-types.ts` (new) — the 7 rate types enum, owned by the future exchange-rates module.
- `apps/api/package.json` (new), `apps/api/tsconfig.json` (new).
- `apps/api/src/app.ts` (new) — builds the Express app: helmet, json limit 16 KB, cookie-parser, cors (origin `WEB_ORIGIN`, credentials), `trust proxy`, pino logger with redaction, HTTPS guard, routes, error handler.
- `apps/api/src/server.ts` (new) — starts the HTTP server.
- `apps/api/src/shared/config/env.ts` (new) — Zod-validated environment.
- `apps/api/src/shared/http/validate.ts` (new) — single validation middleware (params/query/body) with typed handler helper.
- `apps/api/src/shared/http/error-handler.ts` (new) — maps domain/application errors to status + code; no stack in production.
- `apps/api/src/shared/http/origin-guard.ts` (new) — rejects state-changing requests whose `Origin` is not `WEB_ORIGIN` or that lack `X-Requested-With: argent`.
- `apps/api/src/shared/http/health-routes.ts` (new) — `GET /health`.
- `apps/api/src/shared/logging/logger.ts` (new) — pino with redaction paths.
- `apps/api/src/shared/db/client.ts` (new) — Drizzle client over `pg` pool.
- `apps/api/src/shared/db/migrate.ts` (new) — runs migrations.
- `apps/api/drizzle.config.ts` (new) — schema glob `src/*/infrastructure/db/schema.ts`, out `drizzle/`.
- `apps/api/vitest.config.ts` (new), `apps/api/test/setup.ts` (new) — test database, migrations, truncation between tests.
- `apps/web/package.json` (new), `apps/web/tsconfig.json` (new), `apps/web/next.config.ts` (new) — next-intl plugin, security headers (CSP without inline scripts, `Referrer-Policy: strict-origin-when-cross-origin`).
- `apps/web/postcss.config.mjs` (new), `apps/web/src/app/globals.css` (new) — Tailwind and theme tokens (light/dark CSS variables).
- `apps/web/components.json` (new), `apps/web/src/lib/utils.ts` (new) — shadcn/ui config and `cn` helper.
- `apps/web/src/i18n/routing.ts`, `apps/web/src/i18n/request.ts`, `apps/web/src/i18n/navigation.ts` (new) — locales `es` (default) and `en`.
- `apps/web/src/proxy.ts` (new) — next-intl locale routing (route guard added in Block 7).
- `apps/web/messages/es.json`, `apps/web/messages/en.json` (new).
- `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/page.tsx` (new), `apps/web/src/app/manifest.ts` (new).
- `apps/web/vitest.config.ts` (new), `apps/web/test/i18n-catalogs.test.ts` (new).
- `playwright.config.ts` (new) — starts API (with `EMAIL_PROVIDER=mailpit`, `BREACH_CHECKER=fake`) and web.

**Logic**
Tooling, the Express app skeleton with its cross-cutting middleware, the shared package, the web
app shell with i18n and theme tokens, and CI. No product endpoint yet.

**Data model**
- No application table in this block. drizzle-kit keeps its own `__drizzle_migrations` table (`id serial primary key`, `hash text not null`, `created_at bigint`), created by `migrate.ts`.

**API contract**
- Method + path: `GET /health`
- Request: none
- Response: `{ status: "ok" }`
- Error codes: none
- Auth: public

**Input validation**
- `validate.ts` parses `params`, `query` and `body` with Zod schemas from `@argent/shared`, strips unknown keys, and responds 400 `VALIDATION_FAILED` with the list of failing paths.

**Error handling**
- Invalid input — 400 `VALIDATION_FAILED` with field paths, no values echoed.
- Known application error — mapped status + code by `error-handler.ts`.
- Unknown error — 500 `INTERNAL`, logged with request id; no stack trace or SQL message in the body in production.
- Body over 16 KB — 413 `VALIDATION_FAILED`.
- State-changing request without the allowed `Origin` or header — 403 `VALIDATION_FAILED`.
- Plain HTTP in production — 400 `VALIDATION_FAILED`.

**Required tests**
- [ ] `GET /health` returns 200 `{status:"ok"}` — foundation smoke test
- [ ] validation middleware returns 400 with field paths for an invalid body and strips unknown keys — sad path
- [ ] error handler returns 500 `INTERNAL` without stack in production mode — sad path
- [ ] body over 16 KB returns 413 — sad path
- [ ] POST without allowed `Origin` returns 403 — sad path (threat R-19)
- [ ] production request with `X-Forwarded-Proto: http` gets 400 and responses carry `Strict-Transport-Security` — validates NFR-07, sad path
- [ ] a known application error (`PASSWORD_TOO_SHORT`) is mapped to 400 with its code — sad path
- [ ] logger redacts `password`, `token` and cookies — validates NFR-01
- [ ] every key in `messages/es.json` exists in `messages/en.json` and vice versa — validates NFR-10

**Completion criterion**
`pnpm lint`, `pnpm typecheck` and `pnpm test` pass locally and in CI; `docker compose up` starts
PostgreSQL and Mailpit; `pnpm --filter web dev` serves `/es` and `/en`.

## Block 2 — Identity domain, ports and persistence

**Files**
- `apps/api/src/identity/domain/email.ts` (new) — Email value object (trimmed, lower-cased, RFC 5322 basic format, ≤ 254 chars).
- `apps/api/src/identity/domain/password-rules.ts` (new) — pure length rule (≥ 10, ≤ 128).
- `apps/api/src/identity/domain/account-defaults.ts` (new) — pure rules: default rate type MEP, display currency ARS, time zone resolution, language mapping.
- `apps/api/src/identity/domain/errors.ts` (new) — typed domain errors.
- `apps/api/src/identity/application/ports/password-hasher.ts` (new)
- `apps/api/src/identity/application/ports/breached-password-checker.ts` (new)
- `apps/api/src/identity/application/ports/email-sender.ts` (new) — outbox enqueue interface.
- `apps/api/src/identity/application/ports/user-repository.ts` (new)
- `apps/api/src/identity/application/ports/session-repository.ts` (new)
- `apps/api/src/identity/application/ports/one-time-token-repository.ts` (new)
- `apps/api/src/identity/application/ports/attempt-limiter.ts` (new)
- `apps/api/src/identity/application/ports/clock.ts` (new)
- `apps/api/src/identity/application/ports/token-generator.ts` (new) — random tokens and SHA-256 hashing.
- `apps/api/src/identity/infrastructure/db/schema.ts` (new) — Drizzle tables below.
- `apps/api/src/identity/infrastructure/db/drizzle-user-repository.ts` (new)
- `apps/api/src/identity/infrastructure/db/drizzle-session-repository.ts` (new)
- `apps/api/src/identity/infrastructure/db/drizzle-one-time-token-repository.ts` (new)
- `apps/api/src/identity/infrastructure/db/postgres-attempt-limiter.ts` (new)
- `apps/api/src/identity/infrastructure/security/argon2id-password-hasher.ts` (new)
- `apps/api/src/identity/infrastructure/security/hibp-breached-password-checker.ts` (new)
- `apps/api/src/identity/infrastructure/security/fake-breached-password-checker.ts` (new) — deterministic list for tests/e2e.
- `apps/api/src/identity/infrastructure/security/crypto-token-generator.ts` (new)
- `apps/api/src/identity/index.ts` (new) — module barrel (composition root exports).
- `apps/api/drizzle/0000_identity.sql` (new), `apps/api/drizzle/meta/_journal.json` (new), `apps/api/drizzle/meta/0000_snapshot.json` (new) — generated by drizzle-kit.
- `apps/api/drizzle/rollback/0000_identity.down.sql` (new) — reverse migration: drops `email_outbox`, `auth_attempts`, `sessions`, `one_time_tokens`, `users` in that order. Rollback plan for this schema change: there is no production data yet, so reverting means running this script and reverting the commit.

**Logic**
Pure rules for email, password length and account defaults; every I/O concern behind a port in
`application/ports`; Drizzle adapters and security adapters in `infrastructure/`.
- Time zone: accepted if `new Intl.DateTimeFormat('en', { timeZone })` does not throw (accepts IANA links such as `America/Cordoba`); otherwise `America/Argentina/Buenos_Aires`.
- Language: any BCP-47 string; `en` or `en-*` → `en`, anything else or missing → `es`.

**Data model**
- `users`: `id uuid pk default gen_random_uuid()`, `email text not null unique` (stored lower-cased), `password_hash text not null`, `email_verified_at timestamptz null`, `default_rate_type text not null default 'mep'` (check in the 7 rate types), `display_currency text not null default 'ARS'` (check `ARS|USD`), `time_zone text not null`, `language text not null` (check `es|en`), `created_at timestamptz not null default now()`.
- `one_time_tokens`: `id uuid pk`, `user_id uuid not null fk users on delete cascade`, `purpose text not null` (check `email_verification|password_reset`), `token_hash text not null unique`, `expires_at timestamptz not null`, `used_at timestamptz null`, `created_at timestamptz not null default now()`; index `(user_id, purpose)`.
- `sessions`: `id uuid pk`, `user_id uuid not null fk users on delete cascade`, `family_id uuid not null`, `refresh_token_hash text not null unique`, `created_at timestamptz not null default now()`, `last_used_at timestamptz not null`, `revoked_at timestamptz null`, `replaced_by uuid null`; indexes `(user_id)`, `(family_id)`.
- `auth_attempts`: `key text not null`, `kind text not null` (check `sign_in_account|sign_in_ip|register_ip|reset_ip|reset_email|resend_account`), `window_start timestamptz not null`, `count int not null default 0`; primary key `(kind, key, window_start)`; rows older than 24 h deleted by the outbox worker loop.
- `email_outbox`: `id uuid pk`, `kind text not null` (check `verification|password_reset|discard`), `to_email text null`, `language text not null`, `payload jsonb not null`, `created_at timestamptz not null default now()`, `sent_at timestamptz null`, `attempts int not null default 0`; index on `sent_at` where null.

**Input validation**
- Email: string, trimmed, ≤ 254 chars, basic RFC 5322 format.
- Password: string, 10–128 chars.
- Time zone: string ≤ 64 chars, resolved as above.
- Language: string ≤ 35 chars, mapped as above.

**Error handling**
- Password shorter than 10 — `PasswordTooShort` → 400 `PASSWORD_TOO_SHORT`.
- Password in breach list — `PasswordBreached` → 400 `PASSWORD_BREACHED`.
- HIBP timeout (400 ms) or non-200 — `PasswordCheckUnavailable` → 503 `PASSWORD_CHECK_UNAVAILABLE`, nothing persisted.
- Invalid email format — 400 `VALIDATION_FAILED`.
- Unique violation on `users.email` — handled by the register use case (see Block 3), never surfaced.

**Required tests**
- [ ] new account defaults are rate type MEP and display currency ARS — validates AC-18
- [ ] time zone `America/Cordoba` is kept — validates AC-19
- [ ] missing or invalid time zone resolves to `America/Argentina/Buenos_Aires` — validates AC-20
- [ ] language `en-US` maps to `en` — validates AC-21
- [ ] language `pt-BR` and missing language map to `es` — validates AC-22
- [ ] Argon2id hasher uses m=19456, t=2, p=1 and verifies its own hash — validates NFR-01
- [ ] password of 9 chars is rejected by the length rule with `PASSWORD_TOO_SHORT` — validates NFR-02, sad path
- [ ] invalid email format is rejected by the Email value object — sad path
- [ ] inserting a duplicate email raises `DuplicateEmail` from the repository instead of a raw SQL error — sad path
- [ ] HIBP adapter sends only a 5-char prefix and reports a listed suffix as `PASSWORD_BREACHED` (HTTP mocked) — validates NFR-02, sad path
- [ ] HIBP adapter raises `PasswordCheckUnavailable` on timeout and on 5xx — sad path
- [ ] attempt limiter counts per key and window and resets on the next window — validates NFR-03
- [ ] migration applies on an empty database and creates the five tables — foundation

**Completion criterion**
All tests above pass; `pnpm db:migrate` applies `0000_identity.sql`; eslint boundary rule reports
no `domain` → `infrastructure` import.

## Block 3 — Registration, email verification and email outbox

**Files**
- `packages/shared/src/auth/register.ts` (new) — request/response schemas.
- `packages/shared/src/auth/verify-email.ts` (new)
- `packages/shared/src/auth/resend-verification.ts` (new)
- `packages/shared/src/index.ts` (modified) — export auth schemas.
- `apps/api/src/identity/application/register-user.ts` (new)
- `apps/api/src/identity/application/verify-email.ts` (new)
- `apps/api/src/identity/application/resend-verification.ts` (new)
- `apps/api/src/identity/infrastructure/http/registration-routes.ts` (new)
- `apps/api/src/identity/application/ports/email-sender.ts` (modified) — `OutboxEmail` carries `{ kind, userId, toEmail, language }` and **never a token**.
- `apps/api/src/identity/application/ports/attempt-purger.ts` (new) — `purgeOlderThan(cutoff)` port used by the worker.
- `apps/api/src/identity/application/ports/clock.ts` (modified) — port only; `systemClock` moves to `apps/api/src/identity/infrastructure/system-clock.ts` (new).
- `apps/api/src/identity/application/password-policy.ts` (new) — `assertPasswordAcceptable` (length rule + breach port); `apps/api/src/identity/application/ports/breached-password-checker.ts` (modified) loses `assertPasswordNotBreached`.
- `apps/api/src/identity/application/issue-email-token.ts` (new) — used by the worker: invalidates unused tokens of the purpose, creates a new one (hash stored), returns the plaintext to the caller only.
- `apps/api/src/identity/infrastructure/email/outbox-email-sender.ts` (new) — `EmailSender` adapter that inserts into `email_outbox` (no token in the row).
- `apps/api/src/identity/infrastructure/email/email-worker.ts` (new) — polls `email_outbox` every 2 s with `FOR UPDATE SKIP LOCKED`; for `verification` and `password_reset` rows it issues the token **at send time** inside the same transaction, renders, sends via the selected transport, marks `sent_at`; drops `discard` rows; purges `auth_attempts` older than 24 h at most once per hour.
- `apps/api/drizzle/0001_outbox_hardening.sql` (new, generated) and `apps/api/drizzle/meta/_journal.json` (modified) — index `auth_attempts_window_start_idx` on `window_start`; check `email_outbox.language in ('es','en')`.
- `apps/api/drizzle/rollback/0001_outbox_hardening.down.sql` (new) — drops that index, that check and the migration row.
- `apps/api/src/identity/infrastructure/db/schema.ts` (modified) — the index and check above; `payload` typed as `{ userId: string | null }`; outbox kinds derived from the port.
- `apps/api/src/identity/infrastructure/security/argon2id-password-hasher.ts` (modified) — returns `false` only for malformed hashes (logged at warn without hash or password); rethrows any other error.
- `apps/api/src/identity/infrastructure/security/hibp-breached-password-checker.ts` (modified) — cancels the body of non-200 responses; `PasswordCheckUnavailable.cause` is the sanitized failure, not the raw fetch error.
- `apps/api/src/shared/http/validate.ts` (modified) — optional `response` schema per route; `res.json` accepts only that schema's type, so responses are typed with the shared schemas.
- `apps/api/src/identity/infrastructure/email/transports/console-transport.ts` (new)
- `apps/api/src/identity/infrastructure/email/transports/mailpit-transport.ts` (new) — SMTP to Mailpit for local/e2e.
- `apps/api/src/identity/infrastructure/email/transports/resend-transport.ts` (new)
- `apps/api/src/identity/infrastructure/email/render-email.ts` (new) — builds subject/body from catalogs; links from `WEB_BASE_URL` only.
- `apps/api/src/identity/infrastructure/email/messages/es.json`, `apps/api/src/identity/infrastructure/email/messages/en.json` (new)
- `apps/api/src/worker.ts` (new) — worker process entry point.
- `apps/api/src/app.ts` (modified) — mount registration routes.
- `apps/api/test/fakes/in-memory-email-sender.ts` (new) — captures enqueued emails in unit tests.
- `apps/api/test/fakes/capturing-transport.ts` (new) — captures sent emails and their links, so tests read tokens from what was sent, never from the database.

**Logic**
- Register: validate → record the attempt for the IP first and reject when over the limit (atomic, counted the same for new and existing emails) → length + breach check → Argon2id hash → insert user with defaults → enqueue a `verification` row (no token). If the email exists: verify the dummy hash instead, create nothing, enqueue a `discard` row. Same 202 response either way.
- Worker, per `verification` / `password_reset` row, in one transaction holding the row lock: issue the token (invalidate unused ones of that purpose, insert the new hash with its expiry), render the link with the plaintext token, send, set `sent_at`. If the transport fails, the transaction rolls back (no token row survives) and `attempts` is incremented in a separate statement; after 5 attempts the row is marked failed and logged. The plaintext token exists only in worker memory (user decision 2026-09-26, option A).
- Verify: hash submitted token → find unused, unexpired `email_verification` token → set `used_at` and `users.email_verified_at` in one transaction.
- Resend: requires a session of an unverified user; records the attempt first (3 per account per hour, atomic), then enqueues a `verification` row; the worker invalidates previous tokens when it issues the new one.

**Data model**
- Migration `0001_outbox_hardening`: new index `auth_attempts_window_start_idx` on `auth_attempts(window_start)` (not unique); new check constraint `email_outbox_language_check` (`language in ('es','en')`), not null unchanged.
- `email_outbox.payload` stays `jsonb not null`, typed as `{ userId: string | null }`; it never holds a token or any secret.
- `one_time_tokens` rows are created by the worker at send time (unique `token_hash`, `expires_at` 24 h for verification and 60 min for reset, `used_at` null by default).

**API contract**
- Method + path: `POST /auth/register`
- Request: `{ email: string, password: string, timeZone?: string, language?: string }`
- Response: 202 `{ status: "verification_sent" }`
- Error codes: 400 `VALIDATION_FAILED`, 400 `PASSWORD_TOO_SHORT`, 400 `PASSWORD_BREACHED`, 503 `PASSWORD_CHECK_UNAVAILABLE`, 429 `RATE_LIMITED`
- Auth: public; `Origin` guard

- Method + path: `POST /auth/verify-email`
- Request: `{ token: string }`
- Response: 200 `{ status: "verified" }`
- Error codes: 400 `TOKEN_INVALID` (unknown, expired or used), 400 `VALIDATION_FAILED`
- Auth: public; `Origin` guard

- Method + path: `POST /auth/verification/resend`
- Request: `{}`
- Response: 202 `{ status: "verification_sent" }`
- Error codes: 401 `UNAUTHENTICATED`, 429 `RATE_LIMITED`
- Auth: session required (Block 4 middleware), unverified users only (verified users get 202 and nothing is sent)

**Input validation**
- `email` ≤ 254 chars, format; `password` 10–128 chars; `timeZone` ≤ 64 chars; `language` ≤ 35 chars; `token` exactly 43 chars base64url.

**Error handling**
- Weak or breached password — 400 with the specific code, shown by the UI (AC-02).
- HIBP unavailable — 503 `PASSWORD_CHECK_UNAVAILABLE`, UI asks to retry.
- Too many registrations from one IP — 429 `RATE_LIMITED`.
- Token unknown, expired or already used — 400 `TOKEN_INVALID`, UI offers resend (AC-06).
- Email transport failure — worker retries with backoff up to 5 attempts, logs provider error; the HTTP request is unaffected.

**Required tests**
- [ ] valid registration creates an unverified user and enqueues one verification email — validates AC-01
- [ ] password of 9 chars and a breached password are rejected with their codes — validates AC-02
- [ ] registering an existing email returns the same 202 body, creates no user and enqueues a `discard` row — validates AC-03
- [ ] registration stores time zone and language from the request and MEP/ARS defaults — validates AC-18, AC-19, AC-21
- [ ] valid verification token marks the email verified — validates AC-05
- [ ] expired (25 h old) and already-used tokens return `TOKEN_INVALID` — validates AC-06
- [ ] HIBP unavailable returns 503 and creates nothing — sad path
- [ ] 6th registration from one IP within an hour returns 429 — validates NFR-03
- [ ] 4th resend within an hour returns 429 — sad path (R-09)
- [ ] email links use `WEB_BASE_URL` even with a spoofed `Host` header — sad path (R-08)
- [ ] worker sends pending rows once, drops `discard` rows, and two workers never send the same row — validates NFR-09
- [ ] every key in email `messages/es.json` exists in `messages/en.json` — validates NFR-10
- [ ] a transport error is retried up to 5 times with backoff and logged, and the HTTP request is unaffected — sad path
- [ ] a failed send leaves no token row, and a later successful send issues exactly one valid token — sad path
- [ ] after registering and sending, no column of `email_outbox`, `one_time_tokens` or `users` contains the plaintext token captured from the transport — validates NFR-04, threat R-05
- [ ] a second verification email invalidates the first link — validates AC-06
- [ ] the argon2 hasher returns false for a malformed hash and rethrows any other error — sad path
- [ ] HIBP 5xx cancels the response body and the error cause carries no URL — sad path
- [ ] a handler response that does not match the route's response schema fails typecheck (compile-time `@ts-expect-error` test) — validates NFR-10 typing rule
- [ ] purge removes `auth_attempts` rows older than 24 h through the `AttemptPurger` port and runs at most once per hour — validates NFR-03

**Completion criterion**
All tests above pass; a registration against the local stack delivers a Spanish or English
verification email to Mailpit, and opening its link verifies the account.

## Block 4 — Sign-in, sessions and sign-out

**Files**
- `packages/shared/src/auth/sign-in.ts` (new), `packages/shared/src/auth/session.ts` (new) — schemas.
- `packages/shared/src/index.ts` (modified)
- `apps/api/src/identity/application/sign-in.ts` (new)
- `apps/api/src/identity/application/refresh-session.ts` (new)
- `apps/api/src/identity/application/sign-out.ts` (new)
- `apps/api/src/identity/application/sign-out-all.ts` (new)
- `apps/api/src/identity/application/get-current-session.ts` (new)
- `apps/api/src/identity/application/ports/session-repository.ts` (modified), `apps/api/src/identity/infrastructure/db/drizzle-session-repository.ts` (modified) — conditional, atomic `markReplaced` returning whether it claimed the row.
- `apps/api/src/identity/application/ports/access-token-issuer.ts` (new)
- `apps/api/src/identity/infrastructure/security/jose-access-token-issuer.ts` (new) — HS256, `alg` pinned, 15 min.
- `apps/api/src/identity/infrastructure/http/session-cookies.ts` (new) — `__Host-argent_at` (Path=/), `__Secure-argent_rt` (Path=/auth); HttpOnly, Secure, SameSite=Strict.
- `apps/api/src/identity/infrastructure/http/session-routes.ts` (new)
- `apps/api/src/shared/http/require-session.ts` (new) — verifies JWT, loads session row (not revoked, `last_used_at` within 30 days) and the user; attaches `req.auth`; 401 otherwise. Exported for all modules.
- `apps/api/src/app.ts` (modified) — mount session routes.
- `apps/api/test/two-instances.test.ts` (new) — NFR-09.
- `apps/api/test/timing.test.ts` (new) — NFR-08.
- `apps/api/test/bench/auth-latency.bench.ts` (new) — NFR-06.

**Logic**
- Sign-in: validate → check limiter for the normalized email and the IP (before hashing) → load user; if missing, verify the dummy hash → on failure increment both counters and return the generic error → on success create a session (new family), set both cookies. Unverified users do get a session (they need it to resend verification); financial endpoints reject them in Block 6.
- Refresh: hash the cookie → session must exist, not revoked, used within 30 days → claim the rotation atomically (`UPDATE sessions SET revoked_at, replaced_by WHERE id = ? AND revoked_at IS NULL RETURNING id`, in the same transaction as the insert of the successor); if the claim affects no row, it is a reuse: revoke the whole family and return 401; otherwise set the new cookies.
- Sign-out: revoke the current session, clear both cookies.
- Sign-out-all: revoke every session of the user, clear cookies.
- Current session: return user id, email, `emailVerified`, language, time zone.

**API contract**
- Method + path: `POST /auth/sign-in`
- Request: `{ email: string, password: string }`
- Response: 200 `{ user: { id, email, emailVerified, language } }` + cookies
- Error codes: 401 `INVALID_CREDENTIALS` (same body for unknown email and wrong password), 429 `RATE_LIMITED` (same body whether or not the email exists), 400 `VALIDATION_FAILED`
- Auth: public; `Origin` guard

- Method + path: `POST /auth/refresh`
- Request: refresh cookie only
- Response: 200 `{ status: "refreshed" }` + rotated cookies
- Error codes: 401 `UNAUTHENTICATED`
- Auth: refresh cookie; `Origin` guard

- Method + path: `POST /auth/sign-out`
- Request: none
- Response: 204, cookies cleared
- Error codes: none (idempotent)
- Auth: session optional

- Method + path: `POST /auth/sign-out-all`
- Request: none
- Response: 204, cookies cleared
- Error codes: 401 `UNAUTHENTICATED`
- Auth: session required

- Method + path: `GET /auth/session`
- Request: none
- Response: 200 `{ user: { id, email, emailVerified, language, timeZone } }`
- Error codes: 401 `UNAUTHENTICATED`
- Auth: session required

**Input validation**
- `email` ≤ 254 chars; `password` 1–128 chars (length rules are not re-applied at sign-in).

**Error handling**
- Wrong email or password — 401 `INVALID_CREDENTIALS`, generic message (AC-08).
- Limit reached (6th failure per account, 21st per IP within 15 min) — 429 `RATE_LIMITED`, identical for unknown emails; no hashing performed.
- Refresh token reuse — whole family revoked, 401.
- Expired or tampered access token — 401 `UNAUTHENTICATED`.
- Session inactive more than 30 days — 401 `UNAUTHENTICATED`.

**Required tests**
- [ ] verified user with correct password gets a session and both cookies with HttpOnly, Secure, SameSite=Strict — validates AC-07, NFR-05
- [ ] wrong password and unknown email return identical status and body — validates AC-08, NFR-08
- [ ] median response-time difference between unknown email and wrong password is < 50 ms over 200 requests — validates NFR-08
- [ ] 6th failure for one account within 15 min returns 429, identical for a non-existent email — validates NFR-03
- [ ] 21st failure from one IP within 15 min returns 429 — validates NFR-03
- [ ] sign-out revokes the current refresh token and clears cookies; the old access token is rejected — validates AC-12
- [ ] sign-out-all revokes every refresh token of the user — validates AC-13
- [ ] refresh rotates the token; reusing the old one revokes the family — sad path (R-15)
- [ ] two concurrent refreshes with the same token: exactly one succeeds and the other is treated as reuse (family revoked, 401) — sad path (R-15)
- [ ] session idle for 31 days is rejected — validates NFR-05
- [ ] tampered JWT and `alg: none` token are rejected — sad path (R-14)
- [ ] a session created on instance A is accepted by instance B — validates NFR-09
- [ ] p95 of sign-in and registration is < 500 ms over 500 requests — validates NFR-06

**Completion criterion**
All tests above pass; `GET /auth/session` returns the signed-in user and 401 after sign-out.

## Block 5 — Password reset

**Files**
- `packages/shared/src/auth/password-reset.ts` (new) — schemas.
- `packages/shared/src/index.ts` (modified)
- `apps/api/src/identity/application/request-password-reset.ts` (new)
- `apps/api/src/identity/application/confirm-password-reset.ts` (new)
- `apps/api/src/identity/infrastructure/http/password-reset-routes.ts` (new)
- `apps/api/src/identity/index.ts` (modified) — wires the reset use cases and mounts the reset router (the identity module is the composition root; `app.ts` already mounts every identity router).
- `apps/api/src/identity/infrastructure/db/schema.ts` (modified) — `users.credentials_version`, `users.password_changed_at`, `sessions.credentials_version`.
- `apps/api/drizzle/0002_credentials_version.sql` (new, generated), `apps/api/drizzle/meta/_journal.json` (modified), `apps/api/drizzle/meta/0002_snapshot.json` (new, generated).
- `apps/api/drizzle/rollback/0002_credentials_version.down.sql` (new) — drops the three columns and the migration row.
- `apps/api/src/identity/application/ports/user-repository.ts`, `apps/api/src/identity/application/ports/session-repository.ts`, `apps/api/src/identity/infrastructure/db/drizzle-user-repository.ts`, `apps/api/src/identity/infrastructure/db/drizzle-session-repository.ts` (modified) — read and write the credentials version.
- `apps/api/src/identity/application/sign-in.ts`, `apps/api/src/identity/application/refresh-session.ts`, `apps/api/src/identity/application/get-current-session.ts` (modified) — sessions carry the version they were created with; a session whose version differs from the user's is rejected.
- `apps/api/src/identity/infrastructure/email/email-worker.ts` (modified) — drops `password_reset` rows created before `users.password_changed_at`.
- `apps/api/test/identity/password-reset.test.ts`, `apps/api/test/identity/password-reset-use-cases.test.ts`, `apps/api/test/identity/credentials-version.test.ts` (new), `apps/api/test/timing.test.ts` (modified).

**Logic**
- Request: record the attempt first for the IP and for the normalized email (atomic, reject when over the limit) → if the user exists with a verified email, enqueue a `password_reset` row (no token; the worker issues the 60-min token at send time); otherwise enqueue a `discard` row. Same 202 response.
- Request limits: 5 per IP per hour (`reset_ip`), recorded first; then 5 per normalized email per hour (`reset_email`), not counted when the IP is already over its limit.
- Confirm: the pure length rule runs before any transaction; then, in one transaction, consume the unused, unexpired `password_reset` token → breach check → new Argon2id hash → increment `users.credentials_version` and set `users.password_changed_at` → revoke all sessions of the user.
- Credentials version (user decision 2026-09-26, corrective loop after the Block 5 architecture review): every session stores the `credentials_version` of its user at creation (sign-in reads it with the password hash; refresh copies it from the current session). `GetCurrentSession` and refresh reject any session whose version differs from the user's, so a sign-in or refresh racing a reset produces a session that is dead on first use.
- The email worker drops `password_reset` rows created before `users.password_changed_at`, so a link queued before a completed reset is never sent.

**API contract**
- Method + path: `POST /auth/password-reset/request`
- Request: `{ email: string }`
- Response: 202 `{ status: "reset_sent_if_registered" }`
- Error codes: 400 `VALIDATION_FAILED`, 429 `RATE_LIMITED`
- Auth: public; `Origin` guard

- Method + path: `POST /auth/password-reset/confirm`
- Request: `{ token: string, newPassword: string }`
- Response: 200 `{ status: "password_updated" }`
- Error codes: 400 `TOKEN_INVALID`, 400 `PASSWORD_TOO_SHORT`, 400 `PASSWORD_BREACHED`, 503 `PASSWORD_CHECK_UNAVAILABLE`
- Auth: public; `Origin` guard

**Data model**
- `users.credentials_version integer not null default 0`.
- `users.password_changed_at timestamptz null` (null until the first reset).
- `sessions.credentials_version integer not null default 0`.
- Migration `0002_credentials_version` is additive; rollback drops the three columns.

**Input validation**
- `email` ≤ 254 chars; `token` 43 chars base64url; `newPassword` 1–128 code points in the shared schema (the minimum of 10 is the domain rule and returns `PASSWORD_TOO_SHORT`, as decided for Block 3).

**Error handling**
- Token unknown, older than 60 min or already used — 400 `TOKEN_INVALID`, password unchanged, UI offers a new request (AC-11).
- Weak/breached password — same codes as registration.
- Too many requests — 429 `RATE_LIMITED`.

**Required tests**
- [ ] reset request for a registered email enqueues a `password_reset` row without a token and the worker sends a 60-min single-use link; for an unknown email it enqueues a `discard` row; responses are identical — validates AC-09, NFR-08
- [ ] confirming with a valid token updates the password and revokes all sessions — validates AC-10
- [ ] token older than 60 min and a used token return 400 `TOKEN_INVALID` and the password stays unchanged — validates AC-11, NFR-04, sad path
- [ ] breached new password is rejected — sad path
- [ ] 6th reset request for one email within an hour returns 429 — sad path (R-09)
- [ ] 6th reset request from one IP within an hour returns 429 — sad path (R-09)
- [ ] a sign-in that reads the old password hash before a reset commits and creates its session after it gets a session rejected with 401 on first use — sad path, validates AC-10
- [ ] a refresh that races a reset produces a session rejected with 401 — sad path, validates AC-10
- [ ] two concurrent confirms with the same token: exactly one returns 200 — sad path, validates NFR-04
- [ ] a `password_reset` outbox row created before a completed reset is dropped by the worker and no link is sent — sad path
- [ ] median response-time difference of `/auth/password-reset/request` between a registered and an unknown email is < 50 ms over 200 requests — validates NFR-08

**Completion criterion**
All tests above pass; a reset through Mailpit changes the password and the previous session no
longer works.

## Block 6 — Access control

**Files**
- `apps/api/src/shared/http/require-verified-email.ts` (new) — 403 `EMAIL_NOT_VERIFIED` for unverified users. Exported for all modules.
- `apps/api/src/shared/access/access-policy.ts` (new) — `AccessPolicy` port: `canAccess(userId, resource)` = owner OR `GroupMembershipReader.isMember(userId, groupId)`.
- `apps/api/src/shared/access/group-membership-reader.ts` (new) — port.
- `apps/api/src/shared/access/deny-all-group-membership-reader.ts` (new) — default adapter until PRD 05: always "not a member".
- `apps/api/src/shared/access/not-found-unless-allowed.ts` (new) — helper that turns a denied access into 404 `NOT_FOUND`.
- `apps/api/test/fixtures/fixture-resource-routes.ts` (new) — test-only financial resource (`GET/PATCH/DELETE /test-fixtures/:id`), mounted only when `NODE_ENV=test`.
- `apps/api/test/fixtures/fixture-group-membership-reader.ts` (new) — test adapter that returns membership from a fixture table.
- `apps/api/test/fixtures/fixture-schema.sql` (new) — test-only tables.
- `apps/api/src/app.ts` (modified) — mount fixture routes in test only.

**Data model**
- Test-only tables, created by `apps/api/test/fixtures/fixture-schema.sql` in the test database and never in production migrations: `test_fixture_resources` (`id uuid primary key`, `owner_id uuid not null` fk `users` on delete cascade, `group_id uuid null`, `name text not null`), `test_fixture_group_members` (`group_id uuid not null`, `user_id uuid not null` fk `users`, primary key `(group_id, user_id)`).

**Logic**
Financial routes (from later modules) are mounted behind `requireSession` then
`requireVerifiedEmail`; repositories receive the scope from `AccessPolicy`, and any miss becomes
404. The fixture resource exercises the chain until real financial resources exist.

**API contract**
- Method + path: `GET /test-fixtures/:id`, `PATCH /test-fixtures/:id`, `DELETE /test-fixtures/:id` (test environment only)
- Request: `PATCH` body `{ name: string }`
- Response: 200 `{ id, name }` / 204
- Error codes: 401 `UNAUTHENTICATED`, 403 `EMAIL_NOT_VERIFIED`, 404 `NOT_FOUND`
- Auth: session + verified email + ownership or group membership

**Input validation**
- `id` uuid; `name` 1–50 chars.

**Error handling**
- No or invalid session — 401 `UNAUTHENTICATED` (AC-14).
- Unverified email — 403 `EMAIL_NOT_VERIFIED`; the web shows the verify screen (AC-04).
- Resource of another user not shared through a group — 404 `NOT_FOUND`, data unchanged (AC-15, AC-16).

**Required tests**
- [ ] request without session returns 401 — validates AC-14
- [ ] unverified user gets 403 `EMAIL_NOT_VERIFIED` on the fixture resource — validates AC-04
- [ ] verified user after email verification gets 200 on their own resource — validates AC-05
- [ ] reading another user's resource returns 404 with the same body as a non-existent id — validates AC-15
- [ ] updating or deleting another user's resource returns 404 and leaves it unchanged — validates AC-16
- [ ] a group member (fixture reader) can read a resource shared through the group — validates AC-17
- [ ] the default reader denies group access — sad path
- [ ] fixture routes return 404 when `NODE_ENV` is not `test` — sad path

**Completion criterion**
All tests above pass; `requireSession`, `requireVerifiedEmail` and `AccessPolicy` are exported for
other modules.

## Block 7 — Web authentication screens

**Files**
- `apps/web/src/lib/api-client.ts` (new) — fetch wrapper: `credentials: 'include'`, `X-Requested-With: argent`, parses responses with shared Zod schemas, maps error codes to message keys.
- `apps/web/src/lib/device-context.ts` (new) — reads `Intl.DateTimeFormat().resolvedOptions().timeZone` and `navigator.language`.
- `apps/web/src/components/ui/button.tsx`, `input.tsx`, `label.tsx`, `card.tsx`, `form.tsx`, `alert.tsx` (new) — shadcn/ui components.
- `apps/web/src/features/auth/components/register-form.tsx` (new) — presentational.
- `apps/web/src/features/auth/components/sign-in-form.tsx` (new) — presentational.
- `apps/web/src/features/auth/components/forgot-password-form.tsx` (new) — presentational.
- `apps/web/src/features/auth/components/reset-password-form.tsx` (new) — presentational.
- `apps/web/src/features/auth/components/verify-email-notice.tsx` (new) — presentational, with resend button.
- `apps/web/src/features/auth/containers/register-container.tsx`, `sign-in-container.tsx`, `forgot-password-container.tsx`, `reset-password-container.tsx`, `verify-email-container.tsx` (new) — client containers calling the API.
- `apps/web/src/features/auth/components/sign-out-button.tsx` (new)
- `apps/web/src/app/[locale]/(auth)/register/page.tsx`, `sign-in/page.tsx`, `forgot-password/page.tsx`, `reset-password/page.tsx`, `verify-email/page.tsx`, `check-your-email/page.tsx` (new)
- `apps/web/src/app/[locale]/(app)/layout.tsx` (new) — authenticated area shell; calls `GET /auth/session` client-side; redirects to sign-in on 401 and to `check-your-email` when `emailVerified` is false.
- `apps/web/src/proxy.ts` (modified) — sets `Referrer-Policy: no-referrer` on `verify-email` and `reset-password`.
- `apps/web/messages/es.json`, `apps/web/messages/en.json` (modified) — auth copy and error messages.
- `apps/web/e2e/auth.spec.ts` (new) — Playwright flows using Mailpit's API to read emails.

**Logic**
Client-side containers call the API; no Server Component or Server Action touches credentials or
financial data. Registration sends the device time zone and language. Token pages read the token
from the URL and post it to the API. The verify notice offers resend.

**API contract**
- No new endpoint. The screens call the endpoints of Blocks 3–5: `POST /auth/register`, `POST /auth/verify-email`, `POST /auth/verification/resend`, `POST /auth/sign-in`, `POST /auth/sign-out`, `GET /auth/session`, `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm`.
- Request and response bodies: the shared Zod schemas of `@argent/shared/auth`.
- Error codes: the codes listed in those blocks, mapped to message keys by `api-client.ts`.
- Auth: session cookies sent with `credentials: 'include'`; header `X-Requested-With: argent`.

**Input validation**
- Client-side mirrors of the shared schemas (same Zod schemas) for instant feedback; the API remains the authority.

**Error handling**
- `PASSWORD_TOO_SHORT` / `PASSWORD_BREACHED` — inline message naming the failed rule (AC-02).
- `INVALID_CREDENTIALS` — "Invalid email or password" / "Email o contraseña incorrectos" (AC-08).
- `TOKEN_INVALID` — message plus "send a new link" action (AC-06, AC-11).
- `RATE_LIMITED`, `PASSWORD_CHECK_UNAVAILABLE` — retry-later message.
- Network error — generic retry message.

**Required tests**
- [ ] e2e: register → confirmation shown → Mailpit email → open link → verified → sign-in → sign-out — validates AC-01, AC-05, AC-07, AC-12
- [ ] e2e: short password is rejected and shows the "at least 10 characters" rule — validates AC-02, sad path
- [ ] e2e: registering an existing email shows the same confirmation — validates AC-03
- [ ] e2e: unverified user entering the app is sent to the verify-email screen with a resend button — validates AC-04
- [ ] e2e: reused verification link shows the invalid-link error with resend — validates AC-06, sad path
- [ ] e2e: wrong password shows the generic invalid-credentials error — validates AC-08, sad path
- [ ] e2e: forgot password → Mailpit email → new password → old session gone — validates AC-09, AC-10
- [ ] e2e: used reset link shows the invalid-link error — validates AC-11, sad path
- [ ] component: `RATE_LIMITED` and `PASSWORD_CHECK_UNAVAILABLE` show the retry-later message — sad path
- [ ] component: a network failure shows the generic retry message — sad path
- [ ] e2e: browser in English stores language `en` and shows English screens — validates AC-21, NFR-10
- [ ] unit: `device-context` returns the browser time zone — validates AC-19

**Completion criterion**
All e2e tests pass in CI with `BREACH_CHECKER=fake` and `EMAIL_PROVIDER=mailpit`; every auth
screen renders in `/es` and `/en`.

## Block 8 — Email outbox hardening

Supports FR-02 and FR-04 (delivery of verification and reset links) when several workers run.

**Files**
- `apps/api/src/identity/infrastructure/db/schema.ts` (modified) — `email_outbox.next_attempt_at`; polling index on `created_at` where `sent_at is null` replaces the index on `sent_at`.
- `apps/api/drizzle/0003_outbox_retry.sql` (new, generated), `apps/api/drizzle/meta/_journal.json` (modified), `apps/api/drizzle/meta/0003_snapshot.json` (new, generated).
- `apps/api/drizzle/rollback/0003_outbox_retry.down.sql` (new) — drops the column and the new index, restores the previous index, deletes the migration row.
- `apps/api/src/identity/infrastructure/email/email-worker.ts` (modified) — due rows are `next_attempt_at is null or next_attempt_at <= now`; each failure sets `next_attempt_at` (30 s, 90 s, 210 s, 450 s) in the same update that increments `attempts`; the in-memory retry map is removed; the failure update only matches rows with `sent_at is null`, and a missed match is logged at debug without scheduling anything.
- `apps/api/src/identity/infrastructure/email/transports/resend-transport.ts` (modified) — the timed-out request is aborted with an `AbortSignal`; the Resend idempotency key is `<outbox row id>:<attempt number>`, one per attempt, because each attempt carries a new token (a different body) and Resend answers 409 `invalid_idempotent_request` when a key is reused with a different payload.
- `apps/api/src/identity/infrastructure/email/email-transport.ts` (modified) — `EmailMessage.idempotencyKey` (required).
- `apps/api/src/shared/config/env.ts` (modified) — `EMAIL_PROVIDER=resend` requires `NODE_ENV=production` (the Resend SDK prints raw provider errors outside production).
- `apps/api/src/shared/logging/logger.ts` (modified) — redaction targets `toEmail`, `to_email` and `message.to` instead of every key named `to`.
- `apps/api/src/shared/process/graceful-shutdown.ts` (modified) — a second signal exits with code 1; closing the server and the pool has a 10 s deadline.
- `apps/api/test/identity/email-worker-retry.test.ts` (new), plus changes to `apps/api/test/identity/email-transports.test.ts`, `apps/api/test/foundation/env.test.ts`, `apps/api/test/foundation/logger.test.ts`, `apps/api/test/foundation/graceful-shutdown.test.ts`, `apps/api/test/identity/migration.test.ts` (modified).

**Logic**
Retry scheduling moves from worker memory to the database, so every worker sees the same schedule
and a row can never burn its 5 attempts in seconds when several workers poll it. The remaining
changes close the smaller gaps the Block 3 architecture review listed.

**Data model**
- `email_outbox.next_attempt_at timestamptz null` (no default; null means due now).
- Index `email_outbox_pending_idx` on `email_outbox(created_at)` where `sent_at is null`, replacing the partial index on `sent_at`.

**Error handling**
- Transport failure or poison row — `attempts + 1` and `next_attempt_at` set in one statement, only while `sent_at is null`.
- Failure update matches no row (another worker already sent or dropped it) — logged at debug, nothing scheduled.
- Resend timeout — request aborted, counted as a transport failure.
- `EMAIL_PROVIDER=resend` outside production — startup fails with a configuration error.
- Shutdown that does not finish in 10 s, or a second signal — process exits with code 1.

**Required tests**
- [ ] with two workers polling, a failed row is not retried before its `next_attempt_at` — sad path, validates NFR-09
- [ ] after a failure, `attempts` and `next_attempt_at` are updated together, and after 5 failures the row is failed permanently — sad path
- [ ] the failure update on a row that another worker already sent changes nothing and schedules nothing — sad path
- [ ] a Resend call that exceeds the timeout is aborted through its signal, and each attempt of the same row sends a different idempotency key (`<row id>:<attempt>`) — sad path
- [ ] `EMAIL_PROVIDER=resend` with `NODE_ENV` other than production fails to start — sad path
- [ ] a log field named `to` in an unrelated object is kept, while `toEmail`, `to_email` and `message.to` are redacted — sad path
- [ ] a second shutdown signal and a close that exceeds 10 s both exit with code 1 — sad path
- [ ] migration 0003 applies, rolls back and re-applies — foundation

**Completion criterion**
All tests above pass; `pnpm db:migrate` applies `0003_outbox_retry.sql`; the worker keeps no retry
state in memory.

## Final verification
- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm e2e` pass in CI.
- Every FR-01..FR-11 and AC-01..AC-22 of the PRD maps to a passing test listed above.
- No test calls HIBP, Resend or any real external service.
- A database dump contains no plaintext password or token.
- `requireSession`, `requireVerifiedEmail` and `AccessPolicy` are documented in `apps/api/src/shared/` for the next modules.

## Decision log
- 2026-09-26: Package manager pinned to pnpm 11 (user decision, corrective loop from CODE); local PostgreSQL exposed on host port 5434.
- 2026-09-26: Email tokens are issued by the worker at send time; the outbox never stores a token (user decision, option A, corrective loop from CODE after the Block 2 review). Review findings carried in: atomic refresh rotation (Block 4), record-first rate limiting, `AttemptPurger` port, `auth_attempts(window_start)` index, hasher and HIBP error handling, typed responses (Block 3).
- 2026-09-26: Block 3 as built (reviewed and accepted): unit-of-work port and adapter, `auth-context.ts`, `email-transport.ts` and `graceful-shutdown.ts` added; Zod password minimum is 1 so short passwords return `PASSWORD_TOO_SHORT` from the domain; `EMAIL_FROM` env (required with Resend); `EMAIL_PROVIDER` required; outbox rows lose `to_email` when sent or failed and are deleted after 7 days; per-user advisory lock when issuing email tokens; delivery is at-least-once (a send can succeed and its commit fail, producing a second email whose first link is dead); token rows stay locked while an email is being sent (a concurrent verify waits up to the transport timeout).
- 2026-09-26: Block 8 added (corrective loop from CODE after the Block 3 review): retry schedule stored in `email_outbox.next_attempt_at` so several workers share it.
- 2026-09-26: Block 4 as built (reviewed and accepted in 3 rounds): sign-in reserves one attempt unit per account and per IP before Argon2id and refunds it on success and on 429, into the exact window it was reserved in (`AttemptLimiter.record` returns its `windowStart`; `release(policy, key, windowStart)`); a failed refund after a correct password is reported and the sign-in completes; `AuthContext` is `{ userId, sessionId, emailVerified }`; the identity module is built first and hands `requireSession` to other modules' router factories; access tokens carry issuer `argent-api` and audience `argent-access`; only a rotated refresh token counts as reuse; the latency benchmark lives in `apps/api/test/perf/auth-latency.perf.test.ts` and runs in its own `pnpm test:perf` script and CI job; `UNKNOWN_IP` lives in `application/client-ip.ts`. Accepted tradeoff: more than 5 simultaneous in-flight sign-ins to one account get 429 even with the right password.
- 2026-09-26: Block 5 limits: 5 reset requests per IP per hour and 5 per normalized email per hour (spec gave no number; aligned with registration).
- 2026-09-26: Credentials version added to Block 5 (user decision after the Block 5 architecture review): a reset invalidates sessions created concurrently with it and queued reset emails; migration 0002 is `0002_credentials_version`, and Block 8's migration becomes `0003_outbox_retry`.
- 2026-09-28: Block 8 idempotency key changed from the outbox row id to `<row id>:<attempt>` (corrective loop from CODE). Resend keeps keys for 24 h and rejects a reused key with a different payload with 409 `invalid_idempotent_request`; every attempt issues a new token, so a per-row key would make every retry after a timed-out first send fail and leave the user with a dead link. Source: resend.com/docs/dashboard/emails/idempotency-keys. Block 8 also fixes the flaky `migration.test.ts` teardown by resetting schemas instead of dropping the database.
