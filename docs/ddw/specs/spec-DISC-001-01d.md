# Spec DISC-001-01d: Profile, Preferences & Account Deletion

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01d |
| PRD | docs/ddw/prd/prd-DISC-001-01d.md |
| Tier | FEATURE |
| Date | 2026-10-01 |
| Spec loops | 1 |
| Loops since last human decision | 1 |

## Summary
Adds a profile and a permanent account deletion to the `identity` module. A signed-in user reads
`GET /profile` (display name, email, 2FA status, default rate type, display currency, time zone,
interface language), edits any of those but the email with `PATCH /profile`, and deletes the account
with `POST /profile/delete` after re-entering the password. The only schema change is a nullable
`users.display_name` column; the four preferences already live on `users` (DISC-001-01a). Deletion
removes the `users` row in one statement and relies on `ON DELETE CASCADE` foreign keys to remove
every dependent row (sessions, credentials, linked Google identity, one-time tokens, and any later
module's rows); a test discovers every foreign key that points at `users` and asserts that each one
cascades and that no row is left. The re-authentication reuses the sign-in attempt limits, so a wrong
password counts as a failed sign-in attempt. 2FA status is read through a port so this ticket does not
depend on DISC-001-01c's code (it ships a "never enabled" adapter; see Open decisions D-5). The web
app gets a profile and preferences screen and a delete-account screen; changing the interface
language moves the user to the matching locale route. Block 1 adds the shared contracts and
formatters; Block 2 persistence; Block 3 the profile API; Block 4 account deletion; Block 5 the web
screens.

Terminology: the PRD's "account deletion" is the deletion of the login account; in code it is called `DeleteUser` and `UserDeletionRepository`, so it does not collide with the money "Account" of the glossary and the future `accounts` module. The route is `POST /profile/delete`.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 3, Block 5 |
| FR-02 | Block 1, Block 2, Block 3, Block 5 |
| FR-03 | Block 1, Block 3, Block 5 |
| FR-04 | Block 1, Block 3, Block 5 |
| FR-05 | Block 1, Block 3, Block 5 |
| FR-06 | Block 1, Block 3, Block 5 |
| FR-07 | Block 1, Block 3, Block 5 |
| FR-08 | Block 2, Block 4, Block 5 |
| NFR-01 | Strategy: `PATCH /profile` is one `UPDATE users SET … WHERE id = $1 RETURNING …` by primary key, with the display name and preferences validated before it runs (no password hashing, no second round trip, no process-memory cache), and `GET /profile` is one `SELECT` by primary key plus an in-process call to the 2FA status port. A benchmark `apps/api/test/perf/profile-latency.perf.test.ts` (run by `pnpm test:perf`, like the sign-in benchmark) sends 500 `PATCH /profile` requests over 8 connections against the test database and asserts p95 < 300 ms (Block 3). |
| NFR-02 | Strategy: deletion runs in one transaction: `DELETE FROM users WHERE id = $1 AND credentials_version = $2 RETURNING email`, then removal of the user's `email_outbox` rows (by `payload->>'userId'` and by the returned address). The foreign keys already declared with `ON DELETE CASCADE` remove `sessions`, `one_time_tokens` and `user_identities` in that same statement. `apps/api/test/identity/user-erasure.test.ts` keeps a registry of the tables that reference `users` (each with a seeder and its deletion policy, `cascade` today), discovers every foreign key referencing `users` in `pg_constraint`, and fails when a discovered table is not in the registry or a `cascade` entry's constraint is not `ON DELETE CASCADE`, so a module that adds such a table must consciously register it and prove its erasure. It seeds one row per registered table for a user, deletes the account and counts 0 rows for that user in each of them (Block 4). |

## Dependencies between blocks
Block 1 → Block 2 → Block 3 → Block 4 → Block 5. Block 2 uses Block 1's constants (display name
bounds) in its check constraint test; Block 3 uses Block 1's schemas and Block 2's repository; Block 4
uses Block 2's `UserDeletionRepository` and adds a route to Block 3's router file; Block 5 uses the routes
of Blocks 3 and 4 and Block 1's formatter. Execution order: 1, 2, 3, 4, 5.

## Justified new dependencies
None. The time zone check uses the runtime's `Intl`, the amount formatter is plain integer
arithmetic on `bigint`, and the select control is a styled native `<select>` in `components/ui/`
(a Radix select would add `@radix-ui/react-select`, which this ticket does not need).

## Open decisions (assumptions this spec makes; each needs the human's answer)
- **D-1 (re-authentication and 2FA):** the PRD says "re-authenticating" without saying how. This spec
  re-authenticates with the account password only. A user with 2FA enabled is therefore not asked for
  a second factor before deleting. Recommended: require the second factor too, which needs
  DISC-001-01c's verification code, so it is built after 01c merges.
- **D-2 (accounts without a password):** an account created through Google has no password, so it
  cannot pass a password re-authentication. This spec answers `INVALID_CREDENTIALS` (like a wrong
  password, counted the same) and returns `hasPassword: false` in `GET /profile`, so the screen can
  tell the user to set a password first through the existing password reset. Recommended: keep this
  until a Google-based re-authentication exists.
- **D-3 (display name):** no earlier ticket stores a display name, so the column is nullable, no
  existing or new account gets a value, and the profile shows `displayName: null` until the user
  saves one. Names are trimmed; "empty" in AC-03 includes whitespace only; "between 1 and 50
  characters" counts Unicode code points.
- **D-4 (amount format):** AC-09 requires amounts formatted as `1,557.30` in English, but no screen
  shows an amount yet. This spec adds a formatter in `packages/shared` and a fixed sample amount
  (`1,557.30` in English, `1.557,30` in Spanish) on the preferences screen so the rule is visible and
  testable. The sample is labelled as an example on screen. `formatMinorUnits` is hand-written because it must stay exact for any `bigint` without converting to a float and without relying on engine support for numeric strings in `Intl.NumberFormat`. Recommended: keep the sample until a real amount screen exists.
- **D-5 (DISC-001-01c is not on main):** recommended: merge 01c first and rebase this ticket, which removes the stub, the D-1 gap and D-6 at once (the port then reads 01c's `TwoFactorRepository` directly). If the two must merge independently: 2FA status is read through a port
  (`TwoFactorStatusReader`); this ticket ships `NoTwoFactorStatusReader`, which answers `false`
  because no 2FA exists on main. Whichever of 01c and 01d merges second replaces that adapter in
  `createIdentityModule` with one backed by 01c's `TwoFactorRepository` (about five lines). Tests use
  a fake reader that answers `true`.
- **D-6 (migration number):** this ticket's migration is numbered `0005`, as is 01c's
  `0005_two_factor`. Whichever merges second must regenerate its migration as `0006` (rename the SQL
  and rollback files, regenerate the snapshot, fix `_journal.json`).

## Block 1 — Shared contracts, time zone check and amount formatter

**Files**
- `packages/shared/src/profile/profile.ts` (new) — `DISPLAY_NAME_MAX_CODE_POINTS = 50`, `displayNameSchema`, `DISPLAY_CURRENCY_VALUES`, `updateProfileRequestSchema`, `profileResponseSchema`, `deleteAccountRequestSchema` and their inferred types.
- `packages/shared/src/profile/time-zone.ts` (new) — `isIanaTimeZone(value)`, `canonicalTimeZone(value)` and `ianaTimeZoneSchema`.
- `packages/shared/src/money/format-minor-units.ts` (new) — `formatMinorUnits(amount: bigint, locale: 'es' | 'en'): string`.
- `packages/shared/src/index.ts` (modified) — exports the three new modules.
- `packages/shared/tsconfig.json` (modified) — `include` gains `test`, so `pnpm typecheck` covers the new tests.
- `apps/api/src/identity/domain/account-defaults.ts` (modified) — `DISPLAY_CURRENCIES` and `LANGUAGES` become the shared `DISPLAY_CURRENCY_VALUES` and `LANGUAGE_VALUES` (one source for the allowed values; the names and types it exports do not change). `resolveTimeZone`, the registration fallback that keeps a device's zone as reported, is not touched: preference updates canonicalize, existing rows keep what they have.
- `packages/shared/test/profile-schemas.test.ts` (new), `packages/shared/test/time-zone.test.ts` (new), `packages/shared/test/format-minor-units.test.ts` (new).

**Logic**
- `displayNameSchema` is `z.string().trim()` followed by a check that the value has between 1 and 50 code points (`Array.from(value).length`), after an UTF-16 length cap of 200 so an oversized string is rejected without iterating it (same technique as `passwordSchema`).
- `isIanaTimeZone` accepts a value of at most 64 characters that matches `^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$` (this excludes numeric offsets such as `+01:00`, which `Intl` accepts but the IANA database does not list) and that `new Intl.DateTimeFormat('en', { timeZone })` accepts. `canonicalTimeZone` returns `resolvedOptions().timeZone` of that formatter, so `europe/madrid` is stored as `Europe/Madrid`.
- `updateProfileRequestSchema` is a stripping `z.object` with all fields optional: `displayName`, `email` (`emailInputSchema`; present only so the API can reject a different one, FR-03), `defaultRateType` (`rateTypeSchema`), `displayCurrency` (`ARS` | `USD`), `timeZone` (`ianaTimeZoneSchema`, transformed to its canonical form) and `language` (`es` | `en`). A check requires at least one of `displayName`, `defaultRateType`, `displayCurrency`, `timeZone`, `language`.
- `profileResponseSchema`: `{ displayName: string | null, email: string, hasPassword: boolean, twoFactorEnabled: boolean, preferences: { defaultRateType, displayCurrency, timeZone, language } }`.
- `deleteAccountRequestSchema`: `{ password: passwordSchema }`.
- `formatMinorUnits` takes an amount in minor units (2 decimals) as `bigint`, splits it with integer division and remainder (never a float), groups the integer part by thousands and uses `,` and `.` for `en`, `.` and `,` for `es`. Negative amounts get a leading `-`.

**Input validation**
- Display name: string, trimmed, 1 to 50 code points. Rate type: one of `RATE_TYPES`. Display currency: `ARS` or `USD`. Time zone: at most 64 characters, IANA shape, known to `Intl`. Language: `es` or `en`. Email: trimmed string of at most 254 characters. Password: `passwordSchema` (1 to 128 code points). Unknown keys are stripped; an empty update (no changeable field) is rejected.

**Error handling**
- A display name that is empty after trimming or longer than 50 code points fails validation (the API answers 400 `VALIDATION_FAILED`, the previous name stays).
- A time zone that is not in the IANA database, or is a numeric offset, fails validation (400 `VALIDATION_FAILED`).
- An update with no changeable field fails validation (400 `VALIDATION_FAILED`).
- A rate type, display currency or language outside its list fails validation (400 `VALIDATION_FAILED`).

**Required tests**
- [ ] a 1-character and a 50-character display name pass, and the value is trimmed — validates AC-02
- [ ] an empty, whitespace-only and 51-character display name are rejected as invalid — validates AC-03 (sad path)
- [ ] 50 emoji (code points, 100 UTF-16 units) pass and 51 are rejected — validates AC-02, AC-03
- [ ] `Europe/Madrid` and `europe/madrid` both pass and canonicalize to `Europe/Madrid` — validates AC-07
- [ ] `Mars/Olympus`, `+01:00`, an empty string and a 65-character string are rejected as invalid time zones — validates AC-08 (sad path)
- [ ] the request schema accepts an `email` field and strips unknown keys such as `userId` and `passwordHash` — validates FR-03
- [ ] an update with no changeable field is invalid (error) — validates FR-02 (sad path)
- [ ] a rate type, display currency or language outside its list is invalid (error) — validates FR-04, FR-05, FR-07 (sad path)
- [ ] `formatMinorUnits(155730n, 'en')` is `1,557.30` and `'es'` gives `1.557,30`; `5n` is `0.05`; `-155730n` is `-1,557.30`; a value above 2^53 keeps every digit — validates AC-09
- [ ] the API domain's `DISPLAY_CURRENCIES` and `LANGUAGES` are the shared lists, and `newAccountDefaults` still returns the same defaults — validates FR-05

**Completion criterion**
All tests above pass in `packages/shared`; `pnpm typecheck` and `pnpm lint` are clean; no `number` is used for an amount in the formatter.

## Block 2 — Persistence: display name column, profile and account repositories

**Files**
- `apps/api/src/identity/infrastructure/db/schema.ts` (modified) — `users.displayName` and its check constraint.
- `apps/api/drizzle/0005_profile_display_name.sql` (new, generated with `drizzle-kit generate --name profile_display_name`), `apps/api/drizzle/meta/_journal.json` (modified), `apps/api/drizzle/meta/0005_snapshot.json` (new, generated), `apps/api/drizzle/rollback/0005_profile_display_name.down.sql` (new; destructive, see Data model).
- `apps/api/src/identity/application/ports/profile-repository.ts` (new) — `Profile`, `ProfileChanges`, `ProfileRepository`.
- `apps/api/src/identity/application/ports/user-deletion-repository.ts` (new) — `UserDeletionRepository`.
- `apps/api/src/identity/infrastructure/db/drizzle-profile-repository.ts` (new), `apps/api/src/identity/infrastructure/db/drizzle-user-deletion-repository.ts` (new).
- `apps/api/src/identity/index.ts` (modified) — exports the two ports and builds the two adapters in `createIdentityInfrastructure`.
- `apps/api/test/identity/migration.test.ts` (modified) — `ALL_MIGRATIONS` becomes 6 and every rollback chain that starts at `0004_google_identity` first rolls back `0005_profile_display_name` (newest first), with the `ALL_MIGRATIONS - n` offsets adjusted. `apps/api/test/deploy/build-output.test.ts` needs no change (it lists tables, and this migration adds none).
- `apps/api/test/identity/profile-persistence.test.ts` (new).

**Logic**
- `ProfileRepository.findByUserId(userId): Promise<Profile | null>` where `Profile` is `{ userId, email, displayName: string | null, hasPassword: boolean, defaultRateType, displayCurrency, timeZone, language }` (`hasPassword` is `password_hash is not null`; the hash itself never leaves the repository).
- `ProfileRepository.update(userId, changes): Promise<Profile | null>` applies the given subset of `displayName`, `defaultRateType`, `displayCurrency`, `timeZone`, `language` in one `UPDATE … WHERE id = $1 RETURNING …`; resolves null when no user has that id. Fields not in `changes` are untouched.
- `UserDeletionRepository.deleteIfCredentialsVersion(userId, credentialsVersion): Promise<boolean>` opens a transaction, runs `DELETE FROM users WHERE id = $1 AND credentials_version = $2 RETURNING email` and, only when a row was deleted, deletes the `email_outbox` rows whose `payload->>'userId'` is the user id or whose `to_email` is the returned address (the outbox has no foreign key, and its recipient address is personal data), then resolves whether the user was deleted. The foreign keys already declared with `ON DELETE CASCADE` (`one_time_tokens`, `sessions`, `user_identities`) remove the dependent rows in the first statement.
- Every query takes the user id from the caller and scopes by it; there is no query by any other user's key (AGENTS.md ownership rule).
- Why separate ports instead of widening `UserRepository`: every existing test fake and literal implements that interface and DISC-001-01c edits it too, so widening it would touch most identity tests and collide with 01c; `ProfileRepository` and `UserDeletionRepository` stay small and are the only code that writes the profile columns or deletes a user.

**Data model**
- Entity `users` (table `users`), new column `display_name text` nullable, no default; check constraint `users_display_name_check`: `display_name is null or char_length(display_name) between 1 and 50`.
- No new table, no new index (all access is by primary key). Existing columns `default_rate_type`, `display_currency`, `time_zone`, `language` and their check constraints are unchanged.
- Migration `0005_profile_display_name` only adds a nullable column and a check that every existing row satisfies (non-destructive). Its rollback script drops the check and the column; it is destructive (every display name is lost), says so in its header, asks for the API to be stopped first, and deletes its row from `drizzle.__drizzle_migrations`, following `0004_google_identity.down.sql`.

**Input validation**
- The repositories take typed values only: a user id (uuid taken from the session), a credentials version (integer) and `ProfileChanges` already validated by Block 1's schemas (display name 1 to 50 code points, rate type, display currency, time zone and language from their lists); the check constraints repeat the display name and enum rules as the last line of defense.

**Error handling**
- `update` for a user id that does not exist resolves null (the use case maps it to 401), never throws.
- A display name that violates the check constraint (empty or over 50 characters) fails the statement with a database error; the API validates first, so this is unreachable through HTTP and would surface as 500 `INTERNAL` (fail closed).
- `deleteIfCredentialsVersion` with a stale credentials version or an unknown id resolves false and changes nothing.

**Required tests**
- [ ] migration `0005` applies on `0004` with existing users, who keep a null display name, and its rollback restores `0004` — validates FR-02
- [ ] `update` persists a display name and each preference, returns the updated profile, and leaves the other columns untouched — validates AC-02, AC-05, AC-06, AC-07
- [ ] `update` of an unknown user id resolves null and writes nothing (error path) — validates FR-02
- [ ] inserting or updating a display name that is empty or has 51 characters fails on the check constraint (invalid) — validates AC-03
- [ ] `findByUserId` reports `hasPassword` true for a password account and false for a Google-created one, and never returns the hash — validates FR-01
- [ ] `deleteIfCredentialsVersion` deletes the user, cascades to its sessions, one-time tokens and linked identities, and removes its `email_outbox` rows (by user id and by address) in the same transaction while another user's outbox rows stay — validates AC-10
- [ ] `deleteIfCredentialsVersion` with a stale credentials version or an unknown id resolves false and keeps the row (sad path) — validates AC-11

**Completion criterion**
All tests above pass; `drizzle-kit check` is clean; the existing suite still passes with the new migration count.

## Block 3 — Profile API: read, edit, 2FA status port

**Files**
- `apps/api/src/identity/application/ports/two-factor-status-reader.ts` (new) — `TwoFactorStatusReader { isEnabled(userId): Promise<boolean> }`.
- `apps/api/src/identity/infrastructure/security/no-two-factor-status-reader.ts` (new) — adapter that answers `false` (D-5) and logs one `warn` at construction ("2FA status reader is the no-op adapter"), so a deployment that forgot to swap it is visible in the logs.
- `apps/api/src/identity/application/get-profile.ts` (new), `apps/api/src/identity/application/update-profile.ts` (new).
- `apps/api/src/identity/domain/errors.ts` (modified) — `EmailChangeNotAllowed` (an `AppError` with code `VALIDATION_FAILED`, answered 400).
- `apps/api/src/identity/infrastructure/http/profile-routes.ts` (new) — `GET /profile`, `PATCH /profile`.
- `apps/api/src/identity/index.ts` (modified) — wires the use cases and mounts `createProfileRoutes` behind `routeSession`.
- `apps/api/test/fakes/fake-two-factor-status-reader.ts` (new).
- `apps/api/test/identity/profile.test.ts` (new), `apps/api/test/identity/profile-use-cases.test.ts` (new), `apps/api/test/perf/profile-latency.perf.test.ts` (new).

**Logic**
- `GetProfile.execute(userId)` reads `profiles.findByUserId`, asks `twoFactorStatus.isEnabled(userId)` and returns the view the response schema describes; a missing user raises `Unauthenticated`.
- `UpdateProfile.execute(userId, input)`: when `input.email` is present, it is compared with the account's email after `Email.parse` (lower-casing); if it differs, or does not parse, it raises `EmailChangeNotAllowed` before anything is written; an email equal to the current one is ignored. Then one `profiles.update(userId, changes)` call writes every other given field together (all or nothing, so a rejected request never half-applies), and the updated view is returned. A missing user raises `Unauthenticated`.
- The user id always comes from `auth.userId` (set by `requireSession`); the routes never read it from the body or query. Preferences are read from the database on every request; nothing is cached in the process (AGENTS.md stateless rule).
- Routes log one `info` line per outcome with request id, IP, user id and, for updates, the names of the changed fields; never the display name, the email or a preference value.

**Data model**
- No schema change in this block: it reads and updates the Block 2 columns of the existing `users` table (primary key `id`; `display_name` nullable; the preference columns not null with their defaults and check constraints). No new table or index.

**API contract**
- `GET /profile` — Auth: `requireSession` (not `requireVerifiedEmail`, so an unverified user can still read and delete their own data). Request: no body, no params. Response 200: `profileResponseSchema` (`displayName`, `email`, `hasPassword`, `twoFactorEnabled`, `preferences`), with `Cache-Control: no-store`. Error codes: 401 `UNAUTHENTICATED`.
- `PATCH /profile` — Auth: `requireSession`. Request body: `updateProfileRequestSchema` (all fields optional: `displayName`, `email`, `defaultRateType`, `displayCurrency`, `timeZone`, `language`). Response 200: `profileResponseSchema` with the saved values, `Cache-Control: no-store`. Error codes: 400 `VALIDATION_FAILED` (invalid or empty display name, unknown rate type, currency or language, time zone not in IANA, empty update, or an `email` different from the account's; the body lists failing field paths only), 401 `UNAUTHENTICATED`. The origin guard already requires the web origin and `X-Requested-With` on `PATCH`.

**Input validation**
- Validated by the shared schemas of Block 1 through the shared `validate` middleware; the handler receives only parsed values. See Block 1 for types, lengths and allowed values.

**Error handling**
- Invalid or empty display name, bad preference value, time zone outside IANA, or an empty update → 400 `VALIDATION_FAILED` with `fields`, and nothing is written (previous values stay).
- Email different from the account's → 400 `VALIDATION_FAILED` through `EmailChangeNotAllowed`, and the email stays unchanged.
- No or invalid session → 401 `UNAUTHENTICATED`; a session whose user no longer exists is the same 401.
- A failure of the 2FA status port or of the database → 500 `INTERNAL` through the shared error handler (no partial profile is returned).

**Required tests**
- [ ] `GET /profile` returns display name, email and `twoFactorEnabled` true when the fake reader says so and false with the default adapter — validates AC-01
- [ ] the default `NoTwoFactorStatusReader` logs its warning once when the module is built and answers false — validates AC-01
- [ ] `GET /profile` without a session answers 401 and with an expired or revoked session answers 401 (sad path) — validates AC-01
- [ ] `PATCH /profile` with a 1 to 50 character name persists it and the next `GET` shows it — validates AC-02
- [ ] `PATCH /profile` with an empty, whitespace-only or 51-character name answers 400 and the previous name stays — validates AC-03 (sad path)
- [ ] `PATCH /profile` with an `email` different from the account's answers 400 and the email stays unchanged; the same email in another case is accepted as a no-op — validates AC-04, FR-03
- [ ] a rate type and a display currency saved by one session are returned by a new session after sign-out and sign-in — validates AC-05, AC-06
- [ ] `PATCH /profile` with `Europe/Madrid` persists and returns it — validates AC-07
- [ ] `PATCH /profile` with an unknown time zone, `+01:00`, an unknown rate type, currency or language answers 400 and nothing is written (sad path) — validates AC-08
- [ ] `PATCH /profile` with `language: 'en'` persists and returns `en`; a request mixing a valid name with an invalid time zone writes neither — validates AC-09 (API side), FR-07
- [ ] `PATCH /profile` with an empty body or only unknown keys answers 400 (sad path) — validates FR-02
- [ ] a user cannot read or change another user's profile: the id comes from the session and a body `userId` is stripped — validates FR-01 (sad path)
- [ ] `PATCH /profile` without the web origin header answers 403 (sad path) — validates FR-02
- [ ] the log lines of a profile update contain the changed field names and no display name, email or preference value — validates FR-02
- [ ] benchmark: 500 `PATCH /profile` requests over 8 connections have p95 < 300 ms — validates NFR-01

**Completion criterion**
All tests above pass; `GET /profile` and `PATCH /profile` answer as the contract says against the real session middleware; `pnpm test:perf` passes the profile benchmark.

## Block 4 — Account deletion

**Files**
- `apps/api/src/identity/application/delete-user.ts` (new) — `DeleteUser` use case.
- `apps/api/src/identity/infrastructure/http/profile-routes.ts` (modified) — adds `POST /profile/delete`.
- `apps/api/src/identity/index.ts` (modified) — wires `DeleteUser` with the existing attempt limiter, password hasher, users and the Block 2 `UserDeletionRepository`.
- `apps/api/test/identity/delete-user.test.ts` (new), `apps/api/test/identity/user-erasure.test.ts` (new), `apps/api/test/identity/delete-user-races.test.ts` (new).

**Logic**
- `DeleteUser.execute({ userId, password, ip })`: loads the user with `users.findById(userId)` (none → `Unauthenticated`); reserves one unit in `SIGN_IN_ACCOUNT_POLICY` (key `Email.parse(user.email).value`) and one in `SIGN_IN_IP_POLICY` before any hashing, exactly as `SignIn` does (both policies are imported from `sign-in.ts`, which stays unchanged); if either is refused it gives its units back and raises `RateLimited`.
- It verifies the password with `PasswordHasher.verify` against `user.passwordHash`, or against `dummyPasswordHash` when the user has none (D-2), so both paths cost the same. A wrong password, or no password, keeps the reserved units, which is what makes it count as a failed sign-in attempt (AC-11), and raises `InvalidCredentials`; nothing is deleted.
- On a match it gives the units back (a failed refund is reported, not fatal, as in `SignIn`) and calls `accounts.deleteIfCredentialsVersion(user.id, user.credentialsVersion)`. False means the account or its credentials changed while the password was being checked: it raises `Unauthenticated` and deletes nothing.
- On success the route clears the session cookies and answers 204. The cascade removes the user's sessions, so every refresh token and access token stops working at once (`requireSession` checks the live session row). Only the user id, session id, IP and request id are logged; never the email.
- Data that is not removed in the transaction and why: `auth_attempts` rows keyed by the email or IP are purged by the worker after 24 hours. It is not in AC-10's list.
- Guard for later modules: a module that adds a table with a foreign key to `users` must register it in `user-erasure.test.ts` with its seeder and deletion policy. The guard does not mandate `ON DELETE CASCADE` for every module; it only forbids an unregistered table. What happens to records shared with a group is decided by PRD 05 (PRD, Out of Scope), which would register its tables with its own policy.

**Data model**
- No schema change in this block: it deletes a row of `users` (primary key `id`) and relies on the existing foreign keys with `ON DELETE CASCADE` from `sessions`, `one_time_tokens` and `user_identities`; `email_outbox` has no foreign key to `users` (its `user_id` lives in the `payload` jsonb, and `to_email` is nullable), which is why Block 2 deletes its rows explicitly. No new table, constraint or index.

**API contract**
- `POST /profile/delete` — Auth: `requireSession` (not `requireVerifiedEmail`: an unverified user can still delete their own account). Request body: `deleteAccountRequestSchema` (`password`, 1 to 128 code points). Response 204 with no body and the session cookies cleared. Error codes: 400 `VALIDATION_FAILED` (missing or oversized password), 401 `INVALID_CREDENTIALS` (wrong password, or an account without a password), 401 `UNAUTHENTICATED` (no session, or the account changed during the check), 429 `RATE_LIMITED` (too many failed sign-in attempts for the account or IP).

**Input validation**
- `password`: string of 1 to 128 code points through the shared `passwordSchema`; unknown keys are stripped; no other input (the user id comes from the session).

**Error handling**
- Wrong password → 401 `INVALID_CREDENTIALS`, the account stays, one unit stays in each sign-in policy.
- Account without a password (Google-created) → the same 401 `INVALID_CREDENTIALS` and the same limits (D-2).
- Over the sign-in limits → 429 `RATE_LIMITED` before any hashing; the account stays.
- No session, or the credentials version changed while the password was checked → 401 `UNAUTHENTICATED`; the account stays.
- Missing or oversized password → 400 `VALIDATION_FAILED`; nothing is reserved.
- A failed refund of reserved units after a successful check → reported in the log, and the deletion still completes.
- A database failure during the delete → 500 `INTERNAL`; the single `DELETE` statement either removes the user and every dependent row or none.

**Required tests**
- [ ] with the right password the account is deleted, the answer is 204, and the old access and refresh cookies answer 401 afterwards — validates AC-10
- [ ] after deletion, signing in with the same email and password answers 401 and registering the same email creates a new account — validates AC-10
- [ ] zero rows: after deleting a user seeded with a row in every registered table that references `users`, each of those tables has 0 rows for the user id — validates NFR-02, AC-10
- [ ] guard: every foreign key referencing `users` belongs to a registered table, and a table created in the test with a foreign key to `users` and no registry entry makes the guard fail (sad path) — validates NFR-02
- [ ] a Google identity, one-time tokens, every session of the user and the user's other sessions are gone, while another user's rows are untouched — validates AC-10
- [ ] a wrong password answers 401 `INVALID_CREDENTIALS`, nothing is deleted, and the account's `sign_in_account` counter rises by one — validates AC-11 (sad path)
- [ ] 5 wrong passwords in a row make the 6th password sign-in attempt for that email answer 429, and a delete attempt answers 429 without hashing — validates AC-11 (sad path)
- [ ] an account with no password answers 401 `INVALID_CREDENTIALS` and is not deleted — validates AC-11 (sad path)
- [ ] a request without a session answers 401; a missing or 129-character password answers 400 and reserves no attempt — validates AC-11 (sad path)
- [ ] a password reset that lands between the password check and the delete makes the delete answer 401 and keeps the account — validates AC-10 (race, sad path)
- [ ] two parallel delete requests with the right password delete the account once, and the second answers 401 — validates AC-10 (race)
- [ ] a pending verification email of the deleted user is gone from `email_outbox` right after the deletion and the worker sends nothing to the address — validates AC-10
- [ ] the log lines of a deletion contain the user id and no email or password — validates AC-10

**Completion criterion**
All tests above pass; the zero-rows test and the cascade guard pass against the migrated schema; `pnpm test` passes in full.

## Block 5 — Web screens: profile, preferences and delete account

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `getProfile`, `updateProfile`, `deleteAccount`; `RequestOptions.method` gains `PATCH`.
- `apps/web/src/components/ui/select.tsx` (new) — a native `<select>` styled with the same theme tokens as `input.tsx`.
- `apps/web/src/features/profile/components/profile-form.tsx` (new) — display name field, read-only email, 2FA status and the "set a password first" hint.
- `apps/web/src/features/profile/components/preferences-form.tsx` (new) — default rate type, display currency, time zone and interface language selects, and the amount sample.
- `apps/web/src/features/profile/components/delete-account-form.tsx` (new) — warning text, password field, submit.
- `apps/web/src/features/profile/containers/profile-container.tsx` (new), `apps/web/src/features/profile/containers/delete-account-container.tsx` (new).
- `apps/web/src/features/profile/time-zones.ts` (new) — the list for the time zone select, from `Intl.supportedValuesOf('timeZone')` plus the saved value.
- `apps/web/src/features/auth/form-errors.ts` (modified) — `FieldErrorKey` gains the profile field messages; `AuthField` is untouched.
- `apps/web/src/app/[locale]/(app)/settings/profile/page.tsx` (new), `apps/web/src/app/[locale]/(app)/settings/delete-account/page.tsx` (new).
- `apps/web/src/app/[locale]/(app)/page.tsx` (modified) — links to the two screens.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — namespaces `profile` and `deleteAccount` and the new error keys, in both languages.
- Tests: `apps/web/test/profile-container.test.tsx`, `apps/web/test/profile-components.test.tsx`, `apps/web/test/delete-account-container.test.tsx`, `apps/web/test/profile-i18n.test.tsx` (new), `apps/web/test/api-client.test.ts`, `apps/web/test/i18n-catalogs.test.ts` and `apps/web/test/routes.test.tsx` (modified); `apps/web/e2e/profile.spec.ts` (new), `apps/web/e2e/support/accounts.ts` (new) — copies of the `registerAndVerify`, `signIn` and `uniqueEmail` helpers that today are private to `auth.spec.ts`, which this ticket leaves untouched to avoid conflicts with parallel work; `profile.spec.ts` calls `resetAttemptLimits` in `beforeEach` because the delete flow consumes sign-in attempts.

**Logic**
- The containers fetch with the API client (no Server Component touches financial or personal data), the components are pure. The profile container loads `GET /profile`, shows the profile and the preferences, and saves each form with `PATCH /profile`, sending only the changed fields; it validates with the shared schemas first so the same rules give instant feedback.
- When the saved language differs from the current locale, the container navigates to the same path in the saved locale with the `@/i18n/navigation` router (`router.replace(pathname, { locale })`), so every screen shows in that language (AC-09). Amounts go through `formatMinorUnits(amount, locale)`, never `Intl` on a float or a hard-coded format; the preferences screen shows the sample amount `155730n` (D-4).
- The email is displayed as text with no input (FR-03). The 2FA status shows enabled or not enabled from `twoFactorEnabled`. When `hasPassword` is false the delete screen explains that a password must be set first (through "forgot password") and still lets the user try (D-2).
- The delete container posts the password, and on 204 navigates to `/sign-in`. Wrong password, rate limit and network errors are shown above the form with the existing message keys (`invalidCredentials`, `retryLater`, `network`).
- All colors, radii and spacing come from theme tokens; all strings come from the catalogs; the select, inputs, buttons, alert and card are the owned `components/ui` ones.

**API contract**
- Consumes the endpoints of Blocks 3 and 4 and creates none. Method and path: `GET /profile`, `PATCH /profile`, `POST /profile/delete`, sent with `credentials: 'include'` and `X-Requested-With: argent`. Request: the JSON bodies of `updateProfileRequestSchema` (only the changed fields, never `email`) and `deleteAccountRequestSchema`. Response: `profileResponseSchema` for the first two, no body (204) for the delete, parsed with the shared schemas (a body that does not parse becomes `INTERNAL`). Error codes handled: `VALIDATION_FAILED`, `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `RATE_LIMITED`, `NETWORK`, `INTERNAL`. Auth: the session cookies (HttpOnly), refreshed once through `POST /auth/refresh` on 401.

**Input validation**
- Client-side mirror of Block 1: display name 1 to 50 code points after trimming; the selects offer only allowed values; the time zone list comes from the runtime database; the delete password is 1 to 128 characters. The API remains the authority.

**Error handling**
- A rejected display name or time zone (400) keeps the previous value on screen and shows the field message.
- An expired session (401) goes through the client's refresh once, then redirects to sign-in via the authenticated shell.
- A wrong password on deletion (401 `INVALID_CREDENTIALS`) shows the "incorrect password" message and keeps the user signed in; 429 shows the "try again later" message.
- A network failure shows the retry message and does not change local state; the form can be resubmitted.

**Required tests**
- [ ] the profile screen shows display name, email and 2FA status (enabled and not enabled) from the API — validates AC-01
- [ ] saving a 1 to 50 character name calls the API with only that field and shows it afterwards — validates AC-02
- [ ] an empty or 51-character name is rejected on the client with a field message, and a 400 from the API keeps the previous name (sad path) — validates AC-03
- [ ] the email is rendered as plain text with no editable control, and no email is sent in the update — validates AC-04, FR-03
- [ ] the rate type and display currency selects list exactly the allowed values and save the chosen one — validates AC-05, AC-06
- [ ] the time zone select saves `Europe/Madrid`, and a 400 for an invalid time zone shows the field error and keeps the previous value (sad path) — validates AC-07, AC-08
- [ ] switching the interface language to English navigates to the `en` locale route, every string of the screen comes from the English catalog, and the sample amount shows `1,557.30` (Spanish shows `1.557,30`) — validates AC-09
- [ ] the delete screen posts the password, navigates to sign-in on 204, and shows the error message and keeps the user on the screen for a wrong password, a rate limit and a network failure (sad path) — validates AC-10, AC-11
- [ ] the English and Spanish catalogs have the same keys for the new namespaces and no string is hard-coded in the new components — validates FR-07
- [ ] the API client sends `PATCH /profile` and `POST /profile/delete` with credentials and the `X-Requested-With` header, and maps an invalid response body to `INTERNAL` (sad path) — validates FR-02, FR-08
- [ ] Playwright: a verified user edits the display name, changes preferences, signs out and in again and sees them saved — validates AC-02, AC-05, AC-06, AC-07
- [ ] Playwright: switching to English shows the screens in English with `1,557.30`, and switching back shows Spanish with `1.557,30` — validates AC-09
- [ ] Playwright: deleting with a wrong password keeps the account, deleting with the right password signs the user out, and signing in again fails — validates AC-10, AC-11

**Completion criterion**
All tests above pass, including `pnpm e2e` for the new spec; the new screens work in light and dark themes at phone width; `pnpm lint`, `pnpm typecheck` and the coverage floor of 80% hold.

## Rollback and reverse migration
The only schema change is `0005_profile_display_name` (a nullable column and its check). Rollback:
stop the API and the email worker, run `apps/api/drizzle/rollback/0005_profile_display_name.down.sql`
as a whole (it drops the check and the column and forgets the migration; every saved display name is
lost), then revert the commit. The new routes and screens are additive and disappear with the revert.
Account deletion is irreversible by design (PRD, Out of Scope): a revert cannot restore deleted
accounts, so the deletion route should not be enabled in an environment before Block 4's tests pass.

## Final verification
- `GET /profile`, `PATCH /profile` and `POST /profile/delete` behave as their contracts say, with the real session middleware, and each of the PRD's 11 acceptance criteria has at least one passing test.
- `pnpm test` (including the zero-rows test and the cascade guard), `pnpm test:perf` (profile benchmark under 300 ms p95), `pnpm e2e`, `pnpm lint`, `pnpm typecheck` and `pnpm audit --prod --audit-level high` pass; coverage stays at or above 80% lines, branches and functions.
- No float is used for money in code or tests, no UI string is hard-coded, and no new runtime dependency was added.
- Open decisions D-1 to D-6 are answered or explicitly carried to a follow-up ticket before the branch is merged.
