# Spec DISC-001-01e: Display Name at Sign-Up

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01e |
| PRD | docs/ddw/prd/prd-DISC-001-01e.md |
| Tier | FEATURE |
| Date | 2026-10-01 |
| Spec loops | 2 |
| Loops since last human decision | 0 |

## Summary
Every account gets a display name when it is created. For email and password, the registration
request carries a required `displayName`, validated by the same `displayNameSchema` that DISC-001-01d
uses for the profile (trimmed, 1 to 50 code points, no NUL character), so an invalid or missing name
is a 400 before the use case looks at the email (anti-enumeration, NFR-02); a registration for an
already registered email ignores the name and answers exactly as before. For Google, the API now
also asks for the `profile` scope (without it Google never puts `name` in the ID token), the adapter
reads the ID token's `name` claim as an optional value that can never fail a sign-in, and a pure
domain function turns it into the stored name (missing or empty gives `null`, NUL characters are
removed, longer than 50 code points is truncated to its first 50). The account-creation branch of the
Google flow stores it, and so does the supersede branch (a Google sign-in taking over an unverified
password account replaces that account's name with the Google value, so a name typed by whoever
registered it does not survive); linking Google to an existing verified account or signing in again
never changes a name. The `display_name` column and the profile screen already exist (DISC-001-01d,
migration `0007`), so there is no schema change and no migration. The registration screen gets a
required display name field. Block 1 adds the shared schema field, the NUL rule and the pure Google
name rule; Block 2 the registration path; Block 3 the Google scope, claim and account-creation path;
Block 4 the web screen and the end-to-end helpers.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 2 |
| FR-02 | Block 2, Block 4 |
| FR-03 | Block 4 |
| FR-04 | Block 3 |
| FR-05 | Block 1, Block 3 |
| FR-06 | Block 3 |
| FR-07 | Block 3 |
| NFR-01 | Strategy: the registration use case adds no query and no hashing: the name is one more column in the existing `INSERT INTO users`, so the work per request is unchanged. The existing registration benchmark in `apps/api/test/perf/auth-latency.perf.test.ts` (500 requests over 8 connections, p95 limit 500 ms) sends the new required field, and its p95 assertion is the proof (Block 2). |
| NFR-02 | Strategy: `displayName` is validated by the shared schema in the `validate` middleware, before `RegisterUser.execute` runs, so a missing or invalid name answers 400 without any lookup of the email, whether or not it exists; for a valid name the use case's two branches are unchanged (the existing-email branch ignores the name, never stores it and still verifies the dummy hash and enqueues the discard row), so the 202 status and body stay identical. A side effect, identical for new and existing emails and therefore not a leak: a request rejected for its name does not record a `register_ip` attempt. A test registers a new email and an existing email with a valid name and compares status and body byte for byte, and a second test sends an invalid name for both and compares the two 400 answers (Block 2). |

## Dependencies between blocks
Block 1 → Block 2 and Block 3 → Block 4. Block 2 uses the schema field and Block 3 uses the Google
name rule of Block 1; Blocks 2 and 3 are independent of each other; Block 4 uses the registration
contract of Block 2, the Google flow of Block 3 for its e2e test, and the profile screen of
DISC-001-01d. Execution order: 1, 2, 3, 4.

## Justified new dependencies
None.

## Decisions recorded and assumptions of this spec
Decided by the human (recorded in the PRD's decision log):
- The registration form requires a name (modifying DISC-001-01a's API, schema and screen); a Google
  sign-up takes the name from the `name` claim (D-3).
- A Google `name` that is missing or empty gives no display name; one longer than 50 code points is
  truncated to its first 50 (confirmed 2026-10-01).
- Existing accounts keep no display name until the user sets one in the profile (DISC-001-01d).

No migration is needed: the column was added by `0007_profile_display_name` in DISC-001-01d. (If one
were ever needed, the coordinator assigned `0009` to this ticket: 0006 is 02a, 0007 is 01d and 0008
is 07a.) This branch is based on DISC-001-01d's branch, whose PR is not merged yet, and it rebases
onto main once that PR merges.

Decided by the human on 2026-10-01 after the PLAN review (recorded in the PRD's decision log):
- O-1: the API requests the `profile` scope next to `openid email`, so Google includes the `name`
  claim (DISC-001-01b's scope test changes). **Deploy prerequisite:** the human adds the
  `https://www.googleapis.com/auth/userinfo.profile` scope to the consent screen of the Google Cloud
  client "Argent API" before this ships; the PR body repeats it.
- O-2: on the supersede path of DISC-001-01b (a Google sign-in taking over an unverified password
  account) the display name is replaced with the Google `name` claim under the same rules; the PRD
  now says so (AC-08 reworded to "existing verified account", FR-07 and AC-10 added).
- O-3: the risk of impersonation through a free-text display name (R-05 of the threat model) is
  accepted by the owner and is revisited in PRD 05 (groups), where names become visible to others
  and should be shown with the email.

Assumptions of this spec (interpretations of the PRD wording, not decisions of the human):
- A-1: The name is trimmed before validation, "empty" includes a name of only spaces, and
  characters are counted as Unicode code points, as in DISC-001-01d (`displayNameSchema`).
- A-2: Truncating a Google name takes the first 50 code points (never half a surrogate pair) after
  trimming, and trims trailing spaces left by the cut, so a stored name never starts or ends with a
  space.
- A-3: A `name` claim that is not a string is treated as missing by the adapter (the port types it as
  `string | null`), so an odd claim never makes a Google sign-in fail.
- A-4: The registration request for an already registered email ignores the submitted name: it is
  not stored and the existing account is never touched.
- A-5: The registration field is a single text input labelled "Display name", with
  `autoComplete="name"`, placed first in the form.
- A-6: A NUL character (U+0000) is not allowed in a display name: PostgreSQL text cannot store it, so
  the shared schema rejects it (registration and profile, a small hardening of DISC-001-01d's schema)
  and the Google rule removes it, so neither path can turn it into a 500.
- A-7: The messages for an empty and an over-long name exist twice, in the `errors` namespace (used by
  the auth feature's form errors) and in `profile.errors` (used by DISC-001-01d), a deliberate
  duplication because each feature resolves its keys against its own namespace; the rule that picks
  between them is shared (Block 4).

## Block 1 — Shared schema field, NUL rule and the Google name rule

**Files**
- `packages/shared/src/auth/register.ts` (modified) — `registerRequestSchema` gains `displayName: displayNameSchema` (imported from `../profile/profile`), required.
- `packages/shared/src/profile/profile.ts` (modified) — `displayNameSchema` also rejects a value that contains U+0000 (A-6).
- `apps/api/src/identity/domain/display-name.ts` (new) — `displayNameFromGoogleClaim(name: string | null): string | null`, pure.
- `apps/api/test/identity/auth-schemas.test.ts` (modified) — the registration schema calls (lines near 26, 40, 53, 67, 75) carry the new field; `apps/api/test/identity/display-name.test.ts` (new); `packages/shared/test/profile-schemas.test.ts` (modified) — the NUL case.

**Logic**
- `registerRequestSchema` stays a stripping `z.object`; `displayName` is `displayNameSchema` (trim, UTF-16 cap of 200, 1 to 50 code points, no NUL), with no `.optional()`, so a missing, empty, whitespace-only, NUL-containing or 51-code-point name fails the whole request with 400 (field path `body.displayName`). `profile.ts` and `register.ts` import only each other's leaves (`credentials`, `sign-in`, `rate-types`, `time-zone`), so there is no import cycle.
- `displayNameFromGoogleClaim`: null gives `null`; otherwise remove every U+0000, trim; empty gives `null`; if it has more than 50 code points keep the first 50 (`Array.from(value).slice(0, 50).join('')`) and trim the end again; return the result. It imports `DISPLAY_NAME_MAX_CODE_POINTS` from `@argent/shared`.

**Data model**
- No schema change in this block or in the ticket: the column `users.display_name` (nullable text, check `users_display_name_check`, 1 to 50 characters) exists since migration `0007`. The schema meant here is only the Zod request schema.

**Input validation**
- Registration `displayName`: string, trimmed, 1 to 50 code points, no NUL, UTF-16 cap 200 checked first; unknown keys stripped. The Google claim is untrusted: the function reduces any string to a valid name or `null`.

**Error handling**
- A missing `displayName` fails validation (400 `VALIDATION_FAILED`, path `body.displayName`).
- An empty or whitespace-only `displayName` fails validation (400).
- A `displayName` over 50 code points, or containing a NUL character, fails validation (400).
- A Google `name` that is missing, empty after trimming, or only NUL characters gives `null`, never an error.

**Required tests**
- [ ] the registration schema accepts a display name of 1 and of 50 characters and trims it — validates AC-01
- [ ] the registration schema reports a missing display name as invalid (error) — validates AC-02 (sad path)
- [ ] the registration schema reports an empty and a whitespace-only display name as invalid (error) — validates AC-02 (sad path)
- [ ] the registration schema reports a 51-character display name, and one containing a NUL character, as invalid (error); 50 emoji pass (code points, not UTF-16 units) — validates AC-02 (sad path)
- [ ] the profile schema also rejects a display name containing a NUL character as invalid — validates AC-02 (sad path)
- [ ] `displayNameFromGoogleClaim` returns the trimmed name for 1 to 50 code points — validates AC-05
- [ ] `displayNameFromGoogleClaim` returns null for null, an empty string, spaces only and NUL characters only (error path) — validates AC-06
- [ ] `displayNameFromGoogleClaim` keeps the first 50 code points of a longer name, never splits an emoji, leaves no trailing space, and removes a NUL inside the name — validates AC-07

**Completion criterion**
All tests above pass; existing schema tests still pass with the new field; `pnpm typecheck` and `pnpm lint` are clean.

## Block 2 — Registration with a display name

**Files**
- `apps/api/src/identity/application/ports/user-repository.ts` (modified) — `NewUser` gains `displayName?: string | null`.
- `apps/api/src/identity/infrastructure/db/drizzle-user-repository.ts` (modified) — `create` inserts `displayName` (null when absent).
- `apps/api/src/identity/application/register-user.ts` (modified) — `RegisterUserInput.displayName: string`, stored on the new account only.
- `apps/api/src/identity/infrastructure/http/registration-routes.ts` is not modified: it already spreads the validated body into `registerUser.execute({ ...body, ip })`.
- Tests that must send `displayName` (from the impact scan): `apps/api/test/identity/registration.test.ts` (its `register()` helper and every call), `apps/api/test/identity/register-user.test.ts` (`INPUT` and the recorded `NewUser`s), `apps/api/test/identity/email-verification.test.ts` (helper and the `language: 'en'` call), `apps/api/test/identity/email-worker.test.ts` (two registrations), `apps/api/test/access/access-control.test.ts`, `apps/api/test/perf/auth-latency.perf.test.ts`, `apps/api/test/identity/drizzle-user-repository.test.ts` (`newUser()` gains a display name case). `apps/api/test/helpers/session-client.ts` is not affected: `seedUser` calls `users.create` directly.

**Logic**
- `RegisterUser.execute` passes `displayName` to `users.create({ email, passwordHash, displayName, ...defaults })` inside the existing unit of work; the branch for an email that already exists does not read or store it (A-4).
- `DrizzleUserRepository.create` writes `display_name`; a `NewUser` without it (Google-created accounts until Block 3, test seeds) stores null, so the 22 existing callers keep working. The `User` port type has no `displayName`, so tests that assert the stored name read it through `ProfileRepository` or the database.
- Logging is unchanged: the registration log carries the outcome and user id, never the name or the email.

**API contract**
- `POST /auth/register` (modified). Auth: none (public, rate-limited as before). Request body: `{ email, password, displayName, timeZone?, language? }` with `displayName` a required string of 1 to 50 code points after trimming. Response: `202 { status: 'verification_sent' }`, identical for a new and an already registered email. Error codes: 400 `VALIDATION_FAILED` (missing, empty, over-long or NUL-containing `displayName`, or any other invalid field, listing only field paths), 400 `PASSWORD_TOO_SHORT` and `PASSWORD_BREACHED` as before, 429 `RATE_LIMITED`, 503 `PASSWORD_CHECK_UNAVAILABLE` as before.

**Data model**
- No schema change: the column `users.display_name` (nullable text with `users_display_name_check`, 1 to 50 characters) already exists from migration `0007`. No new table, index or migration.

**Input validation**
- `displayName` is validated by `registerRequestSchema` (Block 1) through the shared `validate` middleware before the use case runs; the check constraint repeats the length rule in the database.

**Error handling**
- A missing, empty, over-long or NUL-containing `displayName` answers 400 `VALIDATION_FAILED` before any email lookup, whether or not the email exists, and creates no account and enqueues no email.
- A valid registration for an already registered email answers the same 202 as for a new one, stores nothing and leaves the existing account (including its display name) untouched.
- A concurrent registration of the same email that loses the race answers 202 as before (`DuplicateEmail` is absorbed) and stores nothing.
- Rate limiting, breached passwords and the password policy keep their existing answers.

**Required tests**
- [ ] `POST /auth/register` with a valid email, password and display name of 1 to 50 characters answers 202 and creates the account with that name trimmed of surrounding spaces — validates AC-01
- [ ] registration without a display name, with an empty, whitespace-only or 51-character one answers 400, creates no account and enqueues no email (sad path) — validates AC-02
- [ ] a user who registered with a display name reads it from `GET /profile` after signing in — validates AC-03
- [ ] a registration for an already registered email with a valid name answers the same status and body as for a new email, and leaves the existing account's display name unchanged — validates AC-09, NFR-02
- [ ] an invalid display name answers the same 400 for a new and for an already registered email (sad path) — validates NFR-02
- [ ] `RegisterUser` stores the name only on the created account, and a concurrent duplicate registration stores nothing (error path) — validates FR-02
- [ ] `DrizzleUserRepository.create` stores `display_name`, and stores null when none is given — validates FR-02
- [ ] the log lines of a registration contain no display name and no email — validates FR-02
- [ ] the registration benchmark sends the display name and keeps p95 below 500 ms — validates NFR-01

**Completion criterion**
All tests above pass; every existing API test that registers sends a display name and passes; the registration benchmark passes; the full API suite is green.

## Block 3 — Google scope, claim and account creation

**Files**
- `apps/api/src/identity/application/ports/google-identity-provider.ts` (modified) — `GoogleClaims` gains `name: string | null`.
- `apps/api/src/identity/infrastructure/security/google-oidc-identity-provider.ts` (modified) — `authorizationUrl` requests `openid email profile` (O-1); the ID-token claims schema reads `name` apart and leniently, as `z.string().optional().catch(undefined)`, so a non-string `name` never fails the parse while `sub`, `email`, `email_verified`, `hd` and `nonce` stay strictly validated; the mapping puts the string or `null` in `GoogleClaims.name`.
- `apps/api/src/identity/application/ports/user-repository.ts` (modified) — `supersedeUnverified(id, at, displayName)` gains the new name, `string | null`.
- `apps/api/src/identity/infrastructure/db/drizzle-user-repository.ts` (modified) — `supersedeUnverified` sets `display_name` in the same `UPDATE` that clears the password.
- `apps/api/src/identity/application/complete-google-sign-in.ts` (modified) — the account-creation branch stores `displayNameFromGoogleClaim(claims.name)`, the supersede branch passes the same value to `supersedeUnverified`, and the linking and existing-identity branches do not touch the name.
- `apps/api/test/fixtures/fake-google-oidc.ts` (modified) — `FakeGoogleIdentity` gains an optional `name`; `fakeGoogleLoginHint` and `parseLoginHint` carry it; `signIdToken` puts `name` in the claims only when the requested scope includes `profile`; the scope strings in the approve redirect and the token response include `profile`.
- Tests: `apps/api/test/identity/google-oidc-identity-provider.test.ts` (the scope assertion becomes `openid email profile`; the exact claims `toEqual` gains `name`), `apps/api/test/identity/fake-google-oidc.test.ts`, `apps/api/test/identity/google-sign-in.test.ts`, `apps/api/test/identity/google-persistence.test.ts` (its two `supersedeUnverified` tests), `apps/api/test/identity/google-sign-in-races.test.ts` (its repository wrapper at the `supersedeUnverified` call takes the new argument), `apps/api/test/perf/google-callback.perf.test.ts` (scope in its query), and the `GoogleClaims` literals that need `name: null`: `google-sign-in-races.test.ts` (two places) and `two-factor-enrollment.test.ts`.

**Logic**
- The adapter is the layer that coerces the claim to `string | null`; the application and domain never see another type.
- `CompleteGoogleSignIn.resolveAccount` calls `users.create({ ..., displayName: displayNameFromGoogleClaim(claims.name) })` only where it creates a user (the `created` path); `existing_identity` and `linked` do not write the name, so a name the user set in the profile is never overwritten. The `superseded` branch passes `displayNameFromGoogleClaim(claims.name)` to `supersedeUnverified`, which writes it (possibly `null`) in the same statement as the password removal, so the text a registrant typed for that account is gone once Google takes it over (O-2).
- The claim is untrusted: only the domain function's output (a valid name or `null`) reaches the database (in both the create and the supersede statements), and the claim is never logged.

**Data model**
- No schema change: the column `users.display_name` (nullable text, check `users_display_name_check` of 1 to 50 characters) already exists from migration `0007`; the account-creation branch writes it with the other columns of the existing insert. No new table, index or migration.

**Error handling**
- A supersede of an account that was verified in the meantime returns null and changes nothing, name included (the existing race handling then links it as a verified account).
- A `name` claim that is missing or empty creates the account with no display name and does not fail the sign-in.
- A `name` claim that is not a string is read as missing and does not fail the sign-in, while a malformed `sub`, `email`, `email_verified` or `nonce` still gives `claims_malformed`.
- A repository failure while creating the account follows the existing path of the flow (conflict retry, then 500) and stores no partial name.

**Required tests**
- [ ] a Google sign-up with a `name` claim of 1 to 50 characters creates the account with that display name, visible in `GET /profile` — validates AC-05
- [ ] a Google sign-up with a missing or empty `name` claim creates the account with a null display name and succeeds (error path) — validates AC-06
- [ ] a Google sign-up with a `name` over 50 code points stores its first 50 code points — validates AC-07
- [ ] linking Google to an existing verified account, and a repeat Google sign-in of a linked account, leave a display name set earlier unchanged — validates AC-08
- [ ] a Google sign-in that takes over an unverified password account replaces the name typed at registration with the Google `name` claim, with null when the claim is missing or empty, and with its first 50 code points when longer — validates AC-10
- [ ] `supersedeUnverified` sets the display name together with the password removal, and returns null and changes nothing (name included) for an already verified account (error path) — validates FR-07
- [ ] an ID token whose `name` claim is not a string still signs the user in with no display name (error path), while a malformed required claim still fails with `claims_malformed` — validates FR-05
- [ ] a failure while creating the account stores no display name and follows the existing conflict path (error) — validates FR-04
- [ ] the OIDC adapter requests the `profile` scope, maps the `name` claim to `GoogleClaims.name` and to null when absent — validates FR-04
- [ ] the fake OIDC server issues a `name` only when the identity has one and the requested scope includes `profile` — validates FR-04

**Completion criterion**
All tests above pass; the existing Google sign-in tests pass unchanged in behavior (only fixtures and the scope string carry the change); the full API suite is green.

## Block 4 — Registration screen and end-to-end helpers

**Files**
- `apps/web/src/features/auth/components/register-form.tsx` (modified) — a required display name field first in the form; `RegisterFormValues` gains `displayName`.
- `apps/web/src/features/auth/containers/register-container.tsx` (modified) — sends `displayName` with the other values and maps its validation error.
- `apps/web/src/lib/display-name-error.ts` (new) — `displayNameErrorKind(value: string): 'required' | 'tooLong'`: empty or whitespace-only is `required`, anything else (more than 50 code points) is `tooLong`; used by both features.
- `apps/web/src/features/auth/form-errors.ts` (modified) — `AuthField` gains `displayName`; `FieldErrorKey` gains `displayNameRequired` and `displayNameTooLong`; `toValidationErrors(error, submitted?)` takes the submitted values as an optional second argument and, for a `displayName` issue, picks the key with `displayNameErrorKind` (the shared schema reports empty, whitespace-only and over-long names through one refinement, so the issue code alone cannot tell them apart).
- `apps/web/src/features/profile/profile-errors.ts` (modified) — uses `displayNameErrorKind` instead of its own copy of the rule (behavior unchanged).
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — `auth.fields.displayName` and `errors.displayNameRequired` / `errors.displayNameTooLong`, in both languages (A-7).
- Tests: `apps/web/test/register-container.test.tsx` (its `fillAndSubmit` helper, the exact-body assertion, the focus assertion that now lands on the name field, and the cases that fill only email and password), `apps/web/test/form-errors.test.ts` (the register body without `displayName` that expected only `validationFailed`; the catalog-keys test), `apps/web/test/auth-form-accessibility.test.tsx` (its `INVALID` constant gains the field), `apps/web/test/api-client.test.ts` and `apps/web/test/auth-error-messages.test.tsx` (register calls typed with `RegisterRequest`), `apps/web/test/profile-errors.test.ts` (still green), `apps/web/test/display-name-error.test.ts` (new). `apps/web/test/auth-components.test.tsx` has no registration content and is not touched.
- End-to-end: `apps/web/e2e/auth.spec.ts` (the `register` helper and the inline English registration), `apps/web/e2e/two-factor.spec.ts`, `apps/web/e2e/google.spec.ts` (its `register` helper and `googleUser`, which gains a `name` option) and `apps/web/e2e/support/accounts.ts` fill the new field; `apps/web/e2e/profile.spec.ts` changes its empty-name assertion (a freshly registered user now has a name) and gains a check that the name typed at sign-up shows in the profile.

**Logic**
- The register form shows a text input labelled "Display name" (`auth.fields.displayName`) with `autoComplete="name"` and `required`, before the email field. Submitting with it empty does not call the API: the container validates with the shared `registerRequestSchema` (as it does for email and password) and shows the field message through the existing error mapping.
- The field reuses `AuthField` and `useFocusFirstInvalid` so focus moves to the first invalid field; strings come from the catalogs.

**Data model**
- No schema change: the column `users.display_name` (nullable text, check `users_display_name_check` of 1 to 50 characters) already exists from migration `0007`; this block only sends a field and shows messages. No new table, index or migration.

**Input validation**
- Client-side mirror of Block 1: the field's value is trimmed and checked for 1 to 50 code points and for NUL by the shared schema before any request; the API remains the authority.

**Error handling**
- An empty, whitespace-only or over-long name shows the field message, focuses the field and sends no request.
- A 400 from the API for the name (rare given the client mirror) shows the existing generic validation message above the form.
- A network failure or any other API failure keeps the existing messages and the typed values.

**Required tests**
- [ ] the registration screen shows a display name field marked as required, before the email field — validates AC-04
- [ ] submitting the registration form with the display name empty or only spaces sends no request and shows the required message on the field and moves focus to it (sad path) — validates AC-04
- [ ] a display name of 51 characters shows the too-long message on the field and sends no request (sad path) — validates AC-02
- [ ] a valid registration sends the trimmed display name together with the other fields — validates AC-01
- [ ] `displayNameErrorKind` returns required for empty and whitespace-only values and tooLong for longer ones, and `toValidationErrors` maps both to their keys (error path) — validates AC-02
- [ ] the English and Spanish catalogs have the same keys for the new strings, and the registration form renders in both languages with no missing key — validates FR-03
- [ ] the register form stays accessible: the new field has a label, `aria-invalid` and a described error — validates FR-03
- [ ] Playwright: a visitor registers with a display name, verifies the email, signs in and sees the name on the profile screen — validates AC-03
- [ ] Playwright: submitting the registration without a name keeps the visitor on the form with the required message (sad path) — validates AC-04
- [ ] Playwright: a Google sign-up shows the name from the Google profile on the profile screen — validates AC-05

**Completion criterion**
All tests above pass, including `pnpm e2e` for the registration, Google and profile specs; the existing e2e specs pass with their helpers filling the new field; `pnpm lint`, `pnpm typecheck` and the coverage floor of 80% hold.

## Rollback
There is no schema change, so there is nothing to reverse in the database. Reverting the branch
restores the old registration contract (no `displayName`), the old Google scope and stops storing the
Google name; names already stored stay in `users.display_name`, where DISC-001-01d reads and edits
them. A client that still sends `displayName` after a revert is accepted because the old schema
strips unknown keys.

## Final verification
- Registration requires a display name and stores it trimmed; a Google sign-up stores the `name` claim (missing or empty gives none, longer than 50 code points is truncated); a Google sign-in that takes over an unverified password account replaces its name; linking to a verified account or signing in again never changes a name; registering an already registered email answers exactly as before.
- Each of the PRD's 10 acceptance criteria has at least one passing test.
- `pnpm test`, `pnpm e2e`, `pnpm lint`, `pnpm typecheck` and `pnpm audit --prod --audit-level high` pass; coverage stays at or above 80% lines, branches and functions.
- No UI string is hard-coded, the name and the Google claim are never logged, and no new dependency was added.
- Assumptions A-1 to A-7 are accepted or changed in a new loop before the branch is merged, and the Google Cloud consent screen includes the `userinfo.profile` scope before it ships.
