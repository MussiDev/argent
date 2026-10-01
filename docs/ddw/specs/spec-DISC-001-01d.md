# Spec DISC-001-01d: Profile & Preferences

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01d |
| PRD | docs/ddw/prd/prd-DISC-001-01d.md |
| Tier | FEATURE |
| Date | 2026-10-01 |
| Spec loops | 3 |
| Loops since last human decision | 1 |

## Summary
Adds a profile and editable preferences to the `identity` module. A signed-in user reads
`GET /profile` (display name, email, 2FA status, default rate type, display currency, time zone,
interface language) and edits any of those but the email with `PATCH /profile`. The only schema
change is a nullable `users.display_name` column (migration `0006_profile_display_name`); the four
preferences already live on `users` (DISC-001-01a). 2FA status comes from DISC-001-01c's real
`GetTwoFactorStatus` use case, which is on main. A display name that was never set is returned as
`null` and the screen shows an empty field. `packages/shared` gets the request and response schemas,
an IANA time zone check and an integer-only amount formatter (`formatMinorUnits`) that follows the
interface language. The web app gets a profile and preferences screen under `settings/profile` and a
navigation link; changing the interface language moves the user to the matching locale route.
Account deletion (DISC-001-01f) and the display name at sign-up (DISC-001-01e) are separate tickets.
Block 1 adds the shared contracts and formatters; Block 2 persistence; Block 3 the profile API;
Block 4 the web screen.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 3, Block 4 |
| FR-02 | Block 1, Block 2, Block 3, Block 4 |
| FR-03 | Block 1, Block 3, Block 4 |
| FR-04 | Block 1, Block 3, Block 4 |
| FR-05 | Block 1, Block 3, Block 4 |
| FR-06 | Block 1, Block 3, Block 4 |
| FR-07 | Block 1, Block 3, Block 4 |
| FR-08 | Block 1 |
| NFR-01 | Strategy: `PATCH /profile` is one `UPDATE users SET … WHERE id = $1 RETURNING …` by primary key (plus one primary-key read first when the request carries an `email` to compare, which the web client never sends), with the display name and preferences validated before it runs (no password hashing, no second round trip, no process-memory cache), and `GET /profile` is one `SELECT` by primary key plus the 2FA status lookup of 01c (one or two primary-key reads). A benchmark `apps/api/test/perf/profile-latency.perf.test.ts` (run by `pnpm test:perf`, like the sign-in benchmark) sends 500 `PATCH /profile` requests over 8 connections against the test database and asserts p95 < 300 ms (Block 3). |

## Dependencies between blocks
Block 1 → Block 2 → Block 3 → Block 4. Block 2 uses Block 1's display name bounds in its check
constraint test; Block 3 uses Block 1's schemas and Block 2's repository; Block 4 uses the routes of
Block 3 and Block 1's formatter and schemas. Execution order: 1, 2, 3, 4.

## Justified new dependencies
None. The time zone check uses the runtime's `Intl`, the amount formatter is plain integer
arithmetic on `bigint`, and the select control is a styled native `<select>` in `components/ui/`
(a Radix select would add `@radix-ui/react-select`, which this ticket does not need).

## Decisions recorded and assumptions of this spec
Decided by the human (recorded in the PRD's decision log):
- 2FA status is read from 01c's real code; no stub (D-5).
- The migration is `0006_profile_display_name` because 01c owns `0005`. DISC-001-02a is planned in
  parallel and also claims the next number: whichever merges later renumbers its migration (rename
  the SQL and rollback files, regenerate the snapshot, fix `_journal.json`) (D-6).
- Existing accounts keep no display name (`null`) until the user sets one; the UI handles `null`
  (D-3).
- AC-09/AC-10 (amount formatting by language) are verified by unit tests of the shared formatter
  only; no example amount is shown on any screen, and visual verification is deferred to the screens
  of PRD 02 (D-4).
- No redirect to the saved language after sign-in; account deletion, display name at sign-up and the
  naming `DeleteUser` / `UserDeletionRepository` / `/profile/delete` belong to 01e and 01f.

Assumptions of this spec (interpretations of the PRD wording, not decisions of the human; none
blocks CODE, each can be changed in a new loop):
- A-1: "empty" display name (AC-03) includes a name that is only spaces, names are trimmed before
  validation, and "characters" are counted as Unicode code points.
- A-2: The profile and the preferences are one screen, `settings/profile`, with two forms, and the
  shell navigation gets a "Profile" link next to the "Security" link of 01c.
- A-3: `GET /profile` and `PATCH /profile` use `requireSession` only (not `requireVerifiedEmail`),
  so the API answers an unverified user's own profile; the web shell already keeps unverified users
  out of the screen.

## Block 1 — Shared contracts, time zone check and amount formatter

**Files**
- `packages/shared/src/profile/profile.ts` (new) — `DISPLAY_NAME_MAX_CODE_POINTS = 50`, `displayNameSchema`, `DISPLAY_CURRENCY_VALUES`, `updateProfileRequestSchema`, `profileResponseSchema` and their inferred types.
- `packages/shared/src/profile/time-zone.ts` (new) — `isIanaTimeZone(value)`, `canonicalTimeZone(value)` and `ianaTimeZoneSchema`.
- `packages/shared/src/money/format-minor-units.ts` (new) — `formatMinorUnits(amount: bigint, language: 'es' | 'en'): string`.
- `packages/shared/src/index.ts` (modified) — exports the three new modules.
- `packages/shared/tsconfig.json` (modified) — `include` gains `test`, so `pnpm typecheck` covers the new tests (the package needs no vitest config: the root config already lists it as a project and the defaults find `test/*.test.ts`).
- `apps/api/src/identity/domain/account-defaults.ts` (modified) — `DISPLAY_CURRENCIES` and `LANGUAGES` become the shared `DISPLAY_CURRENCY_VALUES` and `LANGUAGE_VALUES` (one source for the allowed values; the names and types it exports do not change). `resolveTimeZone`, the registration fallback that keeps a device's zone as reported, is not touched: preference updates canonicalize, existing rows keep what they have.
- `packages/shared/test/profile-schemas.test.ts` (new), `packages/shared/test/time-zone.test.ts` (new), `packages/shared/test/format-minor-units.test.ts` (new).

**Logic**
- `displayNameSchema` is `z.string().trim()` followed by a check that the value has between 1 and 50 code points (`Array.from(value).length`), after a UTF-16 length cap of 200 so an oversized string is rejected without iterating it (same technique as `passwordSchema`).
- `isIanaTimeZone` accepts a value of at most 64 characters that matches `^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$` (this excludes numeric offsets such as `+01:00`, which `Intl` accepts but the IANA database does not list) and that `new Intl.DateTimeFormat('en', { timeZone })` accepts. `canonicalTimeZone` returns `resolvedOptions().timeZone` of that formatter, so `europe/madrid` is stored as `Europe/Madrid`.
- `updateProfileRequestSchema` is a stripping `z.object` with all fields optional: `displayName`, `email` (`emailInputSchema`; present only so the API can reject a different one, FR-03), `defaultRateType` (`rateTypeSchema`), `displayCurrency` (`ARS` | `USD`), `timeZone` (`ianaTimeZoneSchema`, transformed to its canonical form) and `language` (`es` | `en`). A check requires at least one of `displayName`, `defaultRateType`, `displayCurrency`, `timeZone`, `language`, so a body with only `email` is invalid too (400 either way, FR-03); the use case's email comparison runs when `email` travels together with another field.
- `profileResponseSchema`: `{ displayName: string | null, email: string, twoFactorEnabled: boolean, preferences: { defaultRateType, displayCurrency, timeZone, language } }`. In the response `timeZone` is a plain `z.string()`, not `ianaTimeZoneSchema`: registration (`resolveTimeZone`, untouched) can already have stored a value that the strict request check would refuse, and the response parser must never make reading the profile fail with a 500 for such a user.
- `formatMinorUnits` takes an amount in minor units (2 decimals) as `bigint`, splits it with integer division and remainder (never a float), groups the integer part by thousands and uses `,` and `.` for `en` (the `en-US` convention) and `.` and `,` for `es` (the `es-AR` convention) as in DISC-001-01a NFR-10. Negative amounts get a leading `-`. It is hand-written because it must stay exact for any `bigint` without converting to a float and without relying on engine support for numeric strings in `Intl.NumberFormat`.

**Input validation**
- Display name: string, trimmed, 1 to 50 code points. Rate type: one of `RATE_TYPES`. Display currency: `ARS` or `USD`. Time zone: at most 64 characters, IANA shape, known to `Intl`. Language: `es` or `en`. Email: trimmed string of at most 254 characters. Amount: a `bigint`. Unknown keys are stripped; an empty update (no changeable field) is rejected.

**Error handling**
- A display name that is empty after trimming or longer than 50 code points fails validation (the API answers 400 `VALIDATION_FAILED`, the previous name stays).
- A time zone that is not in the IANA database, or is a numeric offset, fails validation (400 `VALIDATION_FAILED`).
- An update with no changeable field fails validation (400 `VALIDATION_FAILED`).
- A rate type, display currency or language outside its list fails validation (400 `VALIDATION_FAILED`).

**Required tests**
- [ ] a 1-character and a 50-character display name pass, and the value is trimmed — validates AC-02
- [ ] an empty, whitespace-only and 51-character display name are invalid — validates AC-03 (sad path)
- [ ] 50 emoji (code points, 100 UTF-16 units) pass and 51 are invalid — validates AC-02, AC-03 (sad path)
- [ ] `Europe/Madrid` and `europe/madrid` both pass and canonicalize to `Europe/Madrid` — validates AC-07
- [ ] `Mars/Olympus`, `+01:00`, an empty string and a 65-character string are invalid time zones — validates AC-08 (sad path)
- [ ] the request schema accepts an `email` field and strips unknown keys such as `userId` and `passwordHash` — validates FR-03
- [ ] an update with no changeable field is invalid (error) — validates FR-02 (sad path)
- [ ] a rate type, display currency or language outside its list is invalid (error) — validates FR-04, FR-05, FR-07 (sad path)
- [ ] `formatMinorUnits(155730n, 'en')` is `1,557.30` and `'es'` gives `1.557,30` — validates AC-10
- [ ] `formatMinorUnits` of `5n` is `0.05`, of `0n` is `0.00`, of `-155730n` is `-1,557.30`, and of a value above 2^53 keeps every digit — validates AC-10
- [ ] the API domain's `DISPLAY_CURRENCIES` and `LANGUAGES` are the shared lists, and `newAccountDefaults` still returns the same defaults — validates FR-05

**Completion criterion**
All tests above pass in `packages/shared` and the existing identity domain tests still pass; `pnpm typecheck` and `pnpm lint` are clean; no `number` is used for an amount in the formatter.

## Block 2 — Persistence: display name column and profile repository

**Files**
- `apps/api/src/identity/infrastructure/db/schema.ts` (modified) — `users.displayName` and its check constraint.
- `apps/api/drizzle/0006_profile_display_name.sql` (new, generated with `drizzle-kit generate --name profile_display_name`), `apps/api/drizzle/meta/_journal.json` (modified), `apps/api/drizzle/meta/0006_snapshot.json` (new, generated), `apps/api/drizzle/rollback/0006_profile_display_name.down.sql` (new; destructive, see Data model).
- `apps/api/src/identity/application/ports/profile-repository.ts` (new) — `Profile`, `ProfileChanges`, `ProfileRepository`.
- `apps/api/src/identity/infrastructure/db/drizzle-profile-repository.ts` (new).
- `apps/api/src/identity/index.ts` (modified) — exports the port and builds the adapter in `createIdentityInfrastructure`; `IdentityInfrastructure` gains a required `profiles` field, so `apps/api/test/identity/identity-infrastructure.test.ts` (modified if it builds an object of that type) is checked.
- `apps/api/test/identity/migration.test.ts` (modified) — `ALL_MIGRATIONS` becomes 7 and every rollback chain that starts at `0005_two_factor` first rolls back `0006_profile_display_name` (newest first), with the `ALL_MIGRATIONS - n` offsets adjusted. Today's lines: the `rollback('0005_two_factor')` calls at 203, 238, 320, 377, 409, 460, 529 and 612 (line 460 matters most: the 0004 rollback that must fail on a password-less user needs 0006 rolled back first), the full-chain test at 202-208, and the offsets `-3` (384), `-2` (412), `-1` (464), `-2` (479), `-1` (531) and `-1` (615), each one more than now; a new `describe` covers `0006_profile_display_name`. `apps/api/test/deploy/build-output.test.ts` needs no change (it lists tables, and this migration adds none).
- `apps/api/test/identity/profile-persistence.test.ts` (new).

**Logic**
- `ProfileRepository.findByUserId(userId): Promise<Profile | null>` where `Profile` is `{ userId, email, displayName: string | null, defaultRateType, displayCurrency, timeZone, language }`. The password hash never leaves the repository.
- `ProfileRepository.update(userId, changes): Promise<Profile | null>` applies the given subset of `displayName`, `defaultRateType`, `displayCurrency`, `timeZone` and `language` in one `UPDATE … WHERE id = $1 RETURNING …`; it resolves null when no user has that id. Fields not in `changes` are untouched.
- Every query takes the user id from the caller and scopes by it; there is no query by any other user's key (AGENTS.md ownership rule).
- Why a separate port instead of widening `UserRepository`: every existing test fake and literal implements that interface, so widening it would touch most identity tests; `ProfileRepository` stays small and is the only code that writes the profile columns.

**Data model**
- Entity `users` (table `users`), new column `display_name text` nullable, no default; check constraint `users_display_name_check`: `display_name is null or char_length(display_name) between 1 and 50`.
- No new table, no new index (all access is by primary key). Existing columns `default_rate_type`, `display_currency`, `time_zone`, `language` and their check constraints are unchanged.
- Migration `0006_profile_display_name` only adds a nullable column and a check that every existing row satisfies (non-destructive). Its rollback script drops the check and the column; it is destructive (every display name is lost), says so in its header, asks for the API to be stopped first, and deletes its row from `drizzle.__drizzle_migrations` keyed by the `when` of its journal entry (which must be later than 0005's, or drizzle will not apply it), following `0005_two_factor.down.sql`.

**Input validation**
- The repository takes typed values only: a user id (uuid taken from the session) and `ProfileChanges` already validated by Block 1's schemas (display name 1 to 50 code points, rate type, display currency, time zone and language from their lists); the check constraints repeat the display name and enum rules as the last line of defense.

**Error handling**
- `update` for a user id that does not exist resolves null (the use case maps it to 401), never throws.
- A display name that violates the check constraint (empty or over 50 characters) fails the statement with a database error; the API validates first, so this is unreachable through HTTP and would surface as 500 `INTERNAL` (fail closed).
- `findByUserId` for an unknown id resolves null.

**Required tests**
- [ ] migration `0006` applies on `0005` with existing users, who keep a null display name, and its rollback restores `0005` — validates FR-02
- [ ] `update` persists a display name and each preference, returns the updated profile, and leaves the other columns untouched — validates AC-02, AC-05, AC-06, AC-07
- [ ] `update` of an unknown user id resolves null and writes nothing (error path) — validates FR-02
- [ ] inserting or updating a display name that is empty or has 51 characters fails on the check constraint (invalid) — validates AC-03
- [ ] `findByUserId` returns a null display name for an existing user without one and never returns the password hash — validates AC-01
- [ ] `findByUserId` for an unknown user id resolves null (sad path) — validates AC-01

**Completion criterion**
All tests above pass; `drizzle-kit check` is clean; the existing suite still passes with the new migration count.

## Block 3 — Profile API: read and edit

**Files**
- `apps/api/src/identity/application/get-profile.ts` (new), `apps/api/src/identity/application/update-profile.ts` (new).
- `apps/api/src/identity/domain/errors.ts` (modified) — `EmailChangeNotAllowed` (an `AppError` with code `VALIDATION_FAILED`, answered 400).
- `apps/api/src/identity/infrastructure/http/profile-routes.ts` (new) — `GET /profile`, `PATCH /profile`.
- `apps/api/src/identity/index.ts` (modified) — builds one `GetTwoFactorStatus` and shares it between the 2FA routes and `GetProfile`, wires the use cases and mounts `createProfileRoutes` behind `routeSession`.
- `apps/api/test/identity/profile.test.ts` (new), `apps/api/test/identity/profile-use-cases.test.ts` (new), `apps/api/test/perf/profile-latency.perf.test.ts` (new).

**Logic**
- `GetProfile.execute(userId)` reads `profiles.findByUserId`, asks `GetTwoFactorStatus.execute(userId)` for `enabled` and returns the view the response schema describes; a missing user raises `Unauthenticated`. Depending on that use case instead of a port is a deliberate exception, decided by the human (D-5: read 2FA status from 01c's real code); it reuses 01c's rule that a pending setup is not enabled.
- `UpdateProfile.execute(userId, input)`: when `input.email` is present, it is compared with the account's email after `Email.parse` (lower-casing); if it differs, or does not parse, it raises `EmailChangeNotAllowed` before anything is written; an email equal to the current one is ignored. Then one `profiles.update(userId, changes)` call writes every other given field together (all or nothing, so a rejected request never half-applies), and the updated view is returned. A missing user raises `Unauthenticated`.
- The user id always comes from `auth.userId` (set by `requireSession`); the routes never read it from the body or query. Preferences are read from the database on every request; nothing is cached in the process (AGENTS.md stateless rule).
- Routes log one `info` line per outcome with request id, IP, user id and, for updates, the names of the changed fields; never the display name, the email or a preference value.

**API contract**
- `GET /profile` — Auth: `requireSession`. Request: no body, no params. Response 200: `profileResponseSchema` (`displayName` or null, `email`, `twoFactorEnabled`, `preferences`), with `Cache-Control: no-store`. Error codes: 401 `UNAUTHENTICATED`.
- `PATCH /profile` — Auth: `requireSession`. Request body: `updateProfileRequestSchema` (all fields optional: `displayName`, `email`, `defaultRateType`, `displayCurrency`, `timeZone`, `language`). Response 200: `profileResponseSchema` with the saved values, `Cache-Control: no-store`. Error codes: 400 `VALIDATION_FAILED` (invalid or empty display name, unknown rate type, currency or language, time zone not in IANA, empty update, or an `email` different from the account's; the body lists failing field paths only), 401 `UNAUTHENTICATED`. The origin guard already requires the web origin and `X-Requested-With` on `PATCH`.

**Data model**
- No schema change in this block: it reads and updates the Block 2 columns of the existing `users` table (primary key `id`; `display_name` nullable; the preference columns not null with their defaults and check constraints). No new table or index.

**Input validation**
- Validated by the shared schemas of Block 1 through the shared `validate` middleware; the handler receives only parsed values. See Block 1 for types, lengths and allowed values.

**Error handling**
- Invalid or empty display name, bad preference value, time zone outside IANA, or an empty update → 400 `VALIDATION_FAILED` with `fields`, and nothing is written (previous values stay).
- Email different from the account's → 400 `VALIDATION_FAILED` through `EmailChangeNotAllowed`, and the email stays unchanged.
- No or invalid session → 401 `UNAUTHENTICATED`; a session whose user no longer exists is the same 401.
- A failure of the 2FA status lookup or of the database → 500 `INTERNAL` through the shared error handler (no partial profile is returned).

**Required tests**
- [ ] `GET /profile` returns display name (null for a user without one), email and `twoFactorEnabled` false, and true after the user enabled 2FA through 01c's flow — validates AC-01
- [ ] `GET /profile` for a user whose stored time zone is a legacy value (for example `+01:00`, written directly to the table) answers 200 with that value (error path avoided) — validates AC-01
- [ ] `GET /profile` without a session answers 401 and with an expired or revoked session answers 401 (sad path) — validates AC-01
- [ ] `PATCH /profile` with a 1 to 50 character name persists it and the next `GET` shows it — validates AC-02
- [ ] `PATCH /profile` with an empty, whitespace-only or 51-character name answers 400 and the previous name stays — validates AC-03 (sad path)
- [ ] `PATCH /profile` with an `email` different from the account's answers 400 and the email stays unchanged; the same email in another case, sent together with another valid field, is accepted as a no-op, and a body with only an `email` answers 400 — validates AC-04, FR-03
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

## Block 4 — Web screen: profile and preferences

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `getProfile` and `updateProfile`; `RequestOptions.method` gains `PATCH`.
- `apps/web/src/components/ui/select.tsx` (new) — a native `<select>` styled with the same theme tokens as `input.tsx`.
- `apps/web/src/features/profile/components/profile-form.tsx` (new) — display name field, read-only email and 2FA status.
- `apps/web/src/features/profile/components/preferences-form.tsx` (new) — default rate type, display currency, time zone and interface language selects.
- `apps/web/src/features/profile/containers/profile-container.tsx` (new).
- `apps/web/src/features/profile/time-zones.ts` (new) — the list for the time zone select, from `Intl.supportedValuesOf('timeZone')` plus the saved value.
- `apps/web/src/features/profile/profile-errors.ts` (new) — the profile feature's own error mapping: client-side validation of the shared schemas to keys of the `profile` catalog namespace (`displayNameRequired`, `displayNameTooLong`), and a server failure to the failure's `messageKey` shown above the submitted form. The auth feature's `form-errors.ts` is not touched.
- `apps/web/src/app/[locale]/(app)/settings/profile/page.tsx` (new).
- `apps/web/src/features/auth/components/authenticated-shell.tsx` (modified) — a "Profile" link in the navigation; `apps/web/test/auth-components.test.tsx` (modified): its nav tests (the `en` links and the current-path `it.each`) gain the Profile link and a `/settings/profile` row.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — namespace `profile`, the `app.nav.profile` key and the new error keys, in both languages.
- Tests: `apps/web/test/profile-container.test.tsx`, `apps/web/test/profile-components.test.tsx`, `apps/web/test/profile-i18n.test.tsx` (new), `apps/web/test/api-client.test.ts` and `apps/web/test/routes.test.tsx` (modified); `apps/web/e2e/profile.spec.ts` (new), `apps/web/e2e/support/accounts.ts` (new) — copies of the `registerAndVerify`, `signIn` and `uniqueEmail` helpers that today are private to `auth.spec.ts`, which this ticket leaves untouched to avoid conflicts with parallel work.

**Logic**
- The container fetches with the API client (no Server Component touches personal data), the components are pure. It loads `GET /profile`, shows the profile and the preferences, and saves each form with `PATCH /profile`, sending only the changed fields; it validates with the shared schemas first so the same rules give instant feedback. A null display name shows an empty field (AC-01).
- When the saved language differs from the current locale, the container navigates to the same path in the saved locale with the `@/i18n/navigation` router (`router.replace(pathname, { locale })`), so every screen shows in that language (AC-09).
- The email is displayed as text with no input (FR-03). The 2FA status shows enabled or not enabled from `twoFactorEnabled`.
- No amount is shown on this screen: the formatter of Block 1 is covered by its unit tests only, and visual verification is deferred to PRD 02's screens (decision D-4).
- All colors, radii and spacing come from theme tokens; all strings come from the catalogs; the select, inputs, buttons, alert and card are the owned `components/ui` ones.

**API contract**
- Consumes the endpoints of Block 3 and creates none. Method and path: `GET /profile` and `PATCH /profile`, sent with `credentials: 'include'` and `X-Requested-With: argent`. Request: the JSON body of `updateProfileRequestSchema` (only the changed fields, never `email`). Response: `profileResponseSchema`, parsed with the shared schema (a body that does not parse becomes `INTERNAL`). Error codes handled: `VALIDATION_FAILED`, `UNAUTHENTICATED`, `NETWORK`, `INTERNAL`. Auth: the session cookies (HttpOnly), refreshed once through `POST /auth/refresh` on 401.

**Input validation**
- Client-side mirror of Block 1: display name 1 to 50 code points after trimming; the selects offer only allowed values; the time zone list comes from the runtime database. The API remains the authority.

**Error handling**
- Field-specific messages (empty or too long display name, time zone not in the list) come from client-side validation with the shared schemas, before any request. A 400 from the API (which the client mirror should make rare) is shown as the generic `validationFailed` message above the form that was submitted, with the previous value kept on screen; `ApiFailure` is not changed to carry field paths.
- An expired session (401) goes through the client's refresh once, then redirects to sign-in via the authenticated shell.
- A network failure shows the retry message and does not change local state; the form can be resubmitted.

**Required tests**
- [ ] the profile screen shows display name, email and 2FA status (enabled and not enabled) from the API, and an empty display name field when the API sends null — validates AC-01
- [ ] saving a 1 to 50 character name calls the API with only that field and shows it afterwards — validates AC-02
- [ ] an empty or 51-character name is rejected on the client with a field message, and a 400 from the API shows the generic message above the form and keeps the previous name (sad path) — validates AC-03
- [ ] the email is rendered as plain text with no editable control, and no email is sent in the update — validates AC-04, FR-03
- [ ] the rate type and display currency selects list exactly the allowed values and save the chosen one — validates AC-05, AC-06
- [ ] the time zone select saves `Europe/Madrid`, and a 400 for an invalid time zone shows the generic message and keeps the previous value (sad path) — validates AC-07, AC-08
- [ ] switching the interface language to English navigates to the `en` locale route and every string of the screen comes from the English catalog — validates AC-09
- [ ] the English and Spanish catalogs have the same keys for the new namespace and no string is hard-coded in the new components — validates FR-07
- [ ] `profile-errors.ts` maps each client-side validation failure to its catalog key and a server failure to its message key — validates AC-03
- [ ] the API client sends `GET /profile` and `PATCH /profile` with credentials and the `X-Requested-With` header, and maps an invalid response body to `INTERNAL` (sad path) — validates FR-02
- [ ] the shell navigation shows the "Profile" link and marks it as the current page on `settings/profile` — validates FR-01
- [ ] Playwright: a verified user edits the display name, changes preferences, signs out and in again and sees them saved — validates AC-02, AC-05, AC-06, AC-07
- [ ] Playwright: switching the language to English shows the profile screen in English, and switching back shows Spanish — validates AC-09

**Completion criterion**
All tests above pass, including `pnpm e2e` for the new spec; the new screen works in light and dark themes at phone width; `pnpm lint`, `pnpm typecheck` and the coverage floor of 80% hold.

## Rollback and reverse migration
The only schema change is `0006_profile_display_name` (a nullable column and its check). Rollback:
stop the API and the email worker, run `apps/api/drizzle/rollback/0006_profile_display_name.down.sql`
as a whole (it drops the check and the column and forgets the migration; every saved display name is
lost), then revert the commit. The new routes, the formatter and the screen are additive and
disappear with the revert. If DISC-001-02a merges first and takes `0006`, this migration is
renumbered before it merges (see the decisions above).

## Final verification
- `GET /profile` and `PATCH /profile` behave as their contracts say, with the real session middleware, and each of the PRD's 10 acceptance criteria has at least one passing test.
- `pnpm test`, `pnpm test:perf` (profile benchmark under 300 ms p95), `pnpm e2e`, `pnpm lint`, `pnpm typecheck` and `pnpm audit --prod --audit-level high` pass; coverage stays at or above 80% lines, branches and functions.
- No float is used for money in code or tests, no UI string is hard-coded, and no new runtime dependency was added.
- Assumptions A-1 to A-3 are accepted or changed in a new loop before the branch is merged.
