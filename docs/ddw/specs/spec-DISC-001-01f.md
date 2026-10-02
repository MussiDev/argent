# Spec DISC-001-01f: Account Deletion

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01f |
| PRD | docs/ddw/prd/prd-DISC-001-01f.md |
| Tier | FEATURE |
| Date | 2026-10-02 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary
A signed-in user deletes the account and every row that belongs to it with `POST /profile/delete`,
after re-authenticating. A user with a password sends the password (checked with the same
reserve-then-refund limits as sign-in, so a wrong password counts as a failed sign-in); a user
without a password (an account created through Google) first signs in with Google again: a
session-authenticated `POST /profile/delete/google/start` stores an OAuth state of purpose
`delete_account` (bound to the user, the session and the browser by the binding cookie), the browser
goes to Google with `prompt=login` and `max_age=0`, and the existing Google callback, after its
state, nonce, PKCE and ID-token checks, issues a single-use deletion grant (stored hashed, 5 minutes,
bound to user, session and credentials version) delivered in an HttpOnly cookie scoped to
`/profile/delete`. A user with 2FA also sends a valid TOTP or recovery code, limited with the policies
of disabling 2FA. The deletion is one transaction: it consumes the grant (Google path), deletes the
`users` row and the `email_outbox` rows of that user, and relies on `ON DELETE CASCADE` for every
dependent row (accounts, sessions, one-time tokens, Google identity, 2FA secret and recovery codes,
sign-in challenges, OAuth states, grants). An erasure test discovers the foreign-key graph from
`users` in PostgreSQL and fails when a table is not registered with a seeder or a foreign key does
not cascade, so the pending modules (02b categories, 07a) must register theirs when they merge. The
web app gets a delete-account screen for both re-authentication paths, linked from the profile.
Block 1 adds the shared contracts and the new error code; Block 2 migration `0010` and the
repositories; Block 3 the password and 2FA deletion path with the erasure test; Block 4 the Google
re-authentication; Block 5 the web screen.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 2, Block 3, Block 5 |
| FR-02 | Block 3, Block 5 |
| FR-03 | Block 3, Block 5 |
| FR-04 | Block 1, Block 4, Block 5 |
| NFR-01 | Strategy: deletion removes the `users` row and every dependent row in one transaction through `ON DELETE CASCADE`, then the `email_outbox` rows of the user (no foreign key; matched by `payload->>'userId'` and by address). `apps/api/test/identity/user-erasure.test.ts` keeps a registry of every table that stores user data, each with a seeder, discovers the whole foreign-key graph reachable from `users` in `pg_constraint` (direct and indirect references), and fails when a reachable table is not registered or a foreign key in the graph is not `ON DELETE CASCADE`; it seeds one row per registered table for a user (accounts of DISC-001-02a included), deletes the account and counts 0 rows for that user in every registered table, and it also proves that another user's rows stay. Tables of DISC-001-02b and DISC-001-07a register themselves when they merge (the guard fails until they do) (Block 3). |
| NFR-02 | Strategy: a wrong password is handled by `DeleteUser` with the sign-in policies `SIGN_IN_ACCOUNT_POLICY` (5 per 15 minutes per account) and `SIGN_IN_IP_POLICY` (20 per 15 minutes per IP) of `attempt-policies.ts`, reserved before any Argon2id work and kept on failure; a wrong second-factor code is handled with `TWO_FACTOR_DISABLE_POLICIES` (5 per 15 minutes and 20 per 24 hours per user), reserved before the code is checked, refused with 429 without checking the code when over the limit, kept on failure and refunded on success, and it also records one unit in the sign-in account policy as 01c does. Tests: 6th wrong password for an email answers 429; 6th wrong code within 15 minutes answers 429 without checking the code (Block 3). |
| NFR-03 | Strategy: `deletion_grants` rows hold `token_hash` (SHA-256 of 256 random bits, the token only in the cookie), `user_id`, `session_id`, `credentials_version` and `expires_at = issued + 5 minutes` (`DELETION_GRANT_TTL_MS`). The grant is consumed with one conditional `DELETE … WHERE token_hash AND user_id AND session_id AND credentials_version AND expires_at > now RETURNING`, so it is usable once and only by that user in that session; issuing a new grant replaces the user's previous one; the worker purges expired rows (Block 2, Block 4). |
| NFR-04 | Strategy: the Google flow reuses `GoogleOidcIdentityProvider.exchangeCode` unchanged for the signature, audience, issuer, expiry and nonce checks, and the existing state, nonce and PKCE storage and single-use consumption; the authorization request for this purpose adds `prompt=login` and `max_age=0` so Google asks for the credentials again, and the verified `auth_time` claim, when Google sends it, must not be older than the moment the state was created (minus 60 seconds of skew); the Google subject must equal the one linked to the state's user. Residual: if Google never sends `auth_time`, the control is `prompt=login` plus the state's age (open decision O-1) (Block 4). |

## Dependencies between blocks
Block 1 → Block 2 → Block 3 → Block 4 → Block 5. Block 2 creates the grant and state storage that
Block 4 uses and the `UserDeletionRepository` that Block 3 uses; Block 3 introduces `DeleteUser`
(password and second factor) that Block 4 extends with the grant path; Block 5 uses the routes of
Blocks 3 and 4. Execution order: 1, 2, 3, 4, 5.

## Justified new dependencies
None.

## Decisions recorded, open decisions and assumptions of this spec
Decided by the human (recorded in the PRD's decision log): a user with 2FA needs the password and a
valid second factor (D-1); a password-less user re-authenticates with Google through a short-lived,
single-use grant bound to the deletion intent, reusing 01b's state, nonce and PKCE protections (D-2);
no deletion email; the names `DeleteUser`, `UserDeletionRepository` and `/profile/delete`; a user with
a password and a Google link deletes with the password and Google re-authentication is only for
accounts without a password; the grant expires after 5 minutes.

Migration: `0010_account_deletion` adds the `deletion_grants` table and three columns of
`oauth_states` (it is numbered `0010`: 0006 is accounts, 0007 profile, 0008 and 0009 belong to
DISC-001-07a and DISC-001-02b). Drizzle applies migrations in the order of the journal's `when`
timestamps, so the `when` of `0010` must be later than the `when` of every entry already in the
journal, including `0009` once DISC-001-02b generates it; if 0009 is generated after this branch
generated 0010, the `when` of 0010 (and the matching key of its rollback script) is bumped before
merging. CODE checks the journal of `origin/main` right before generating the migration.

Merge notes: DISC-001-01e (PR #14, not merged) also changes the Google adapter (`profile` scope, the
`name` claim), `complete-google-sign-in.ts`, `toValidationErrors` and the `GoogleClaims` type; the
changes of this ticket in those files are small and the second ticket to merge rebases. This ticket
does not depend on 01e.

Open decisions for the human (the spec carries the recommended answer; none blocks CODE):
- O-1 (`auth_time`): the human asked for the threat "`auth_time` with `max_age=0` uncertainty" to be
  judged. The spec enforces `auth_time` when Google sends it and otherwise relies on `prompt=login`
  and the age of the state; failing closed when it is absent would break deletion for Google users
  if Google omits the claim. Recommended: keep this, and check with a real Google account in the
  environment (manual step before the release) whether the ID token carries `auth_time` for a
  request with `max_age=0`; recorded as accepted risk R-09 of the threat model, to be confirmed by
  the owner.
- O-2 (an account without a password and without a Google link): such an account cannot
  re-authenticate and is answered `REAUTHENTICATION_REQUIRED`; the web screen tells the user to set
  a password first (forgot password). It should not exist in practice (Google creation and supersede
  always link). Recommended: keep.

Assumptions (interpretations, not human decisions; each can be changed in a new loop):
- A-1: a user with a password who sends no password (or a user without a password who sends none and
  has no valid grant) is refused without reserving a limit unit, because it is not a guess.
- A-2: a user with 2FA who sends no second-factor code is refused with `TOTP_INVALID` (400) without
  reserving units; a wrong or reused code is counted as in disabling.
- A-3: deletion shares the second-factor budget of disabling 2FA (`TWO_FACTOR_DISABLE_POLICIES`),
  so a stolen session cannot guess codes through both routes with separate budgets.
- A-4: `GET /profile` gains `deletionReauth: 'password' | 'google'` (a user with a password is
  `password`, otherwise `google`) so the screen knows which path to show; this changes the response of
  DISC-001-01d (its schema, use case, repository and tests).
- A-5: `POST /profile/delete/google/start` refuses a user that has a password (400
  `VALIDATION_FAILED`), enforcing the PRD's "password for users with a password".
- A-6: the web redirect after Google carries only a flag (`?reauth=ready` or `?reauth=failed`), never
  a token; the grant travels in its HttpOnly cookie.
- A-7: a new error code `REAUTHENTICATION_REQUIRED` (401) tells the screen that the grant is missing,
  expired, used or from another session; the PRD asks for 401.
- A-8: starting a Google re-authentication is limited per IP with the existing `google_start_ip`
  policy, and deletion has no email-based limit besides those of NFR-02.

## Block 1 — Shared contracts and the new error code

**Files**
- `packages/shared/src/profile/delete-account.ts` (new) — `deleteAccountRequestSchema` (`{ password?: string, secondFactorCode?: string }`), `startDeletionReauthResponseSchema` (`{ authorizationUrl: string }`) and their types.
- `packages/shared/src/profile/profile.ts` (modified) — `profileResponseSchema` gains `deletionReauth: z.enum(['password', 'google'])`.
- `packages/shared/src/errors.ts` (modified) — `ERROR_CODES` gains `REAUTHENTICATION_REQUIRED`.
- `packages/shared/src/index.ts` (modified) — exports the new module.
- `apps/api/src/shared/http/error-handler.ts` (modified) — `STATUS_BY_CODE`: `REAUTHENTICATION_REQUIRED` is 401.
- `apps/api/src/identity/domain/errors.ts` (modified) — `ReauthenticationRequired` (an `AppError`).
- `packages/shared/test/delete-account.test.ts` (new), `packages/shared/test/profile-schemas.test.ts` and `apps/api/test/foundation/` error-handler test (modified: the new code maps to 401).

**Logic**
- `deleteAccountRequestSchema` is a stripping object: `password` uses the existing `passwordSchema` (1 to 128 code points), `secondFactorCode` uses `secondFactorCodeSchema` (a 6-digit code or a recovery code as typed, trimmed); both optional, because which one is needed depends on the account (the use case decides).
- `startDeletionReauthResponseSchema.authorizationUrl` is a string URL.
- `profileResponseSchema.deletionReauth` is required in the response.

**Input validation**
- `password`: string, 1 to 128 code points; `secondFactorCode`: a 6-digit code or a recovery code, at most 16 characters before normalization; unknown keys stripped.

**Error handling**
- An oversized or non-string `password` fails validation (400 `VALIDATION_FAILED`).
- A `secondFactorCode` that is neither a 6-digit code nor a recovery code shape fails validation (400).
- `ReauthenticationRequired` is answered 401 with code `REAUTHENTICATION_REQUIRED` by the shared error handler.

**Required tests**
- [ ] the request schema accepts a password, a code, both, or neither, and trims the code — validates FR-02
- [ ] the request schema rejects a 129-character password and a malformed second-factor code as invalid (error) — validates FR-02 (sad path)
- [ ] the request schema strips unknown keys — validates FR-02
- [ ] the profile response schema carries `deletionReauth` and rejects any other value as invalid (error) — validates FR-01
- [ ] `REAUTHENTICATION_REQUIRED` is a known error code and the error handler answers 401 with the bare code — validates AC-09

**Completion criterion**
All tests above pass; `pnpm typecheck` and `pnpm lint` are clean (the profile screen tests of DISC-001-01d fail until Block 3 and Block 5 update them, which is expected).

## Block 2 — Migration 0010, grant and state storage, deletion repository

**Files**
- `apps/api/src/identity/infrastructure/db/schema.ts` (modified) — `oauth_states` gains `purpose`, `user_id`, `session_id`; new table `deletion_grants`.
- `apps/api/drizzle/0010_account_deletion.sql` (new, generated with `drizzle-kit generate --name account_deletion`), `apps/api/drizzle/meta/_journal.json` (modified), `apps/api/drizzle/meta/0010_snapshot.json` (new, generated), `apps/api/drizzle/rollback/0010_account_deletion.down.sql` (new; destructive, see Data model).
- `apps/api/src/identity/application/ports/oauth-state-repository.ts` (modified) — `OAuthState` and `NewOAuthState` carry `purpose`, `userId` and `sessionId`.
- `apps/api/src/identity/infrastructure/db/drizzle-oauth-state-repository.ts` (modified) — stores and returns the new fields.
- `apps/api/src/identity/application/ports/deletion-grant-repository.ts` (new) — `DeletionGrantRepository` (`replace`, `findLive`, `consume`), and `DeletionGrantPurger`.
- `apps/api/src/identity/infrastructure/db/drizzle-deletion-grant-repository.ts` (new).
- `apps/api/src/identity/application/ports/user-deletion-repository.ts` (new), `apps/api/src/identity/infrastructure/db/drizzle-user-deletion-repository.ts` (new).
- `apps/api/src/identity/application/ports/unit-of-work.ts` (modified) and `drizzle-unit-of-work.ts` (modified) — `TransactionalRepositories` gains `deletionGrants` and `userDeletion`, so the grant and the deletion share one transaction.
- `apps/api/src/identity/infrastructure/email/email-worker.ts` (modified) — the retention purge also deletes expired grants (its own `try`), and `apps/api/src/identity/index.ts` (modified) wires the adapters and exports the ports.
- Tests: `apps/api/test/identity/migration.test.ts` (modified: count and chains for `0010`), `apps/api/test/identity/deletion-persistence.test.ts` (new), `google-persistence.test.ts` (the `OAuthStateRepository` cases carry the new fields), `email-worker.test.ts` (grant purge), `apps/api/test/identity/identity-infrastructure.test.ts` (new repositories) and the fakes or literals of `TransactionalRepositories` that typecheck demands.

**Logic**
- `OAuthStateRepository.create` stores `purpose` (`sign_in` default, or `delete_account`), `userId` and `sessionId` (null for sign-in); `consume` returns them. The consume statement is unchanged (single use, binding, expiry).
- `DeletionGrantRepository.replace(grant)` deletes the user's previous grants and inserts the new one in one transaction (one active grant per user); `findLive(tokenHash, userId, sessionId, credentialsVersion, now)` reads without consuming; `consume(...)` is `DELETE … WHERE token_hash = $1 AND user_id = $2 AND session_id = $3 AND credentials_version = $4 AND expires_at > $5 RETURNING token_hash` and resolves whether a row was deleted; `purgeExpired(now)` deletes expired rows.
- `UserDeletionRepository.deleteIfCredentialsVersion(userId, credentialsVersion)` runs inside the caller's transaction: `DELETE FROM users WHERE id = $1 AND credentials_version = $2 RETURNING email`, and only when a row was deleted it deletes the `email_outbox` rows whose `payload->>'userId'` is the user id or whose `to_email` is the returned address (the outbox has no foreign key, and its recipient address is personal data); it resolves whether the user was deleted. The foreign keys with `ON DELETE CASCADE` remove everything else.
- Every query is by the user's own keys; there is no query by another user's id.

**Data model**
- `oauth_states`: new `purpose text not null default 'sign_in'` with check in (`sign_in`, `delete_account`); `user_id uuid null` foreign key to `users` `on delete cascade`; `session_id uuid null` foreign key to `sessions` `on delete cascade`; a check that a `delete_account` row has both `user_id` and `session_id`; existing rows keep `sign_in`.
- `deletion_grants` (new): `token_hash text primary key`, `user_id uuid not null` fk `users` on delete cascade, `session_id uuid not null` fk `sessions` on delete cascade, `credentials_version integer not null`, `expires_at timestamptz not null`, `created_at timestamptz not null default now()`; index on `user_id` and index on `expires_at`.
- Migration `0010_account_deletion` only adds columns, a table, constraints and indexes (non-destructive). Its rollback script deletes the `delete_account` states, drops the table and the three columns with their checks; it is destructive (pending grants and states are lost), says so in its header, asks for the API and the worker to be stopped first, and deletes its row from `drizzle.__drizzle_migrations` keyed by the `when` of its journal entry, which must be later than the `when` of every other entry (see the ordering note above).

**Input validation**
- The repositories take typed values only: hashes produced by the token generator, uuids from the session, and an expiry computed by the use case; the check constraints repeat the purpose rule in the database.

**Error handling**
- `consume` of a grant that is unknown, expired, used, for another user or session, or for an older credentials version resolves false and changes nothing.
- `deleteIfCredentialsVersion` for an unknown user or a stale credentials version resolves false and deletes nothing (not even the outbox rows).
- A `delete_account` state without a user or session is rejected by the database check (invalid), and would surface as 500 only through a bug.

**Required tests**
- [ ] migration `0010` applies on `0007` and the later migrations with existing OAuth states, which keep the purpose `sign_in`, and its rollback restores the previous schema — validates AC-06
- [ ] a stored `delete_account` state returns its purpose, user and session when consumed, once, and a `sign_in` state keeps working unchanged — validates AC-06
- [ ] a `delete_account` state without a user id or without a session id is rejected by the check constraint (invalid) — validates AC-07 (sad path)
- [ ] `replace` keeps one live grant per user, `findLive` finds it without consuming it, and `consume` deletes it exactly once — validates NFR-03
- [ ] `consume` fails for an expired grant, another user, another session, an older credentials version and an unknown hash (sad path) — validates AC-09
- [ ] `purgeExpired` removes only expired grants, and the email worker's retention purge calls it even when an earlier purge fails — validates NFR-03
- [ ] `deleteIfCredentialsVersion` deletes the user, its dependent rows and its `email_outbox` rows (by user id and by address) in one transaction, and leaves another user's rows — validates AC-01
- [ ] `deleteIfCredentialsVersion` with a stale credentials version or an unknown id resolves false and keeps every row (sad path) — validates AC-01

**Completion criterion**
All tests above pass; `drizzle-kit check` is clean; the existing suite passes with the new migration count; `0010`'s `when` is later than every other journal entry.

## Block 3 — Deleting with the password and a second factor, and the erasure guard

**Files**
- `apps/api/src/identity/application/delete-user.ts` (new) — `DeleteUser`.
- `apps/api/src/identity/infrastructure/http/profile-routes.ts` (modified) — adds `POST /profile/delete`; clears the session and grant cookies on success.
- `apps/api/src/identity/infrastructure/http/session-cookies.ts` (modified) — `DELETION_GRANT_COOKIE` (`__Secure-argent_del`, `Strict`, path `/profile/delete`, 5 minutes) and its set and clear helpers (used by Block 4 as well).
- `apps/api/src/identity/application/ports/profile-repository.ts` (modified), `drizzle-profile-repository.ts` (modified), `get-profile.ts` and `update-profile.ts` (modified) — `Profile.hasPassword` and the view's `deletionReauth`.
- `apps/api/src/identity/index.ts` (modified) — wires `DeleteUser` with the existing attempt limiter, password hasher, users, 2FA repositories, TOTP engine, secret box, unit of work and clock.
- Tests: `apps/api/test/identity/delete-user.test.ts` (new), `apps/api/test/identity/delete-user-races.test.ts` (new), `apps/api/test/identity/user-erasure.test.ts` (new), `profile.test.ts`, `profile-use-cases.test.ts`, `profile-persistence.test.ts` (modified for `deletionReauth`).

**Logic**
- `DeleteUser.execute({ userId, sessionId, password, secondFactorCode, grantToken, ip })`: loads the user (none gives `Unauthenticated`) and the user's 2FA settings.
- User with a password: a missing password is `InvalidCredentials` without reserving (A-1); otherwise it reserves one unit in `SIGN_IN_ACCOUNT_POLICY` (key `Email.parse(email).value`) and one in `SIGN_IN_IP_POLICY`, refunds and answers `RateLimited` when refused, verifies with `PasswordHasher.verify`, keeps the units on failure (`InvalidCredentials`) and refunds them on success (a failed refund is reported, not fatal). A grant cookie is ignored: Google re-authentication is not accepted for this account.
- User without a password: handled by Block 4 (this block answers `ReauthenticationRequired` until then).
- 2FA enabled: a missing code is `TotpInvalid` without reserving (A-2); otherwise `reserveAttempt` with `TWO_FACTOR_DISABLE_POLICIES` keyed by the user id, refund and `RateLimited` without checking when refused, `parseSecondFactorCode` and `checkSecondFactorCode` (01c), a wrong, reused or malformed code keeps its units, records one unit in the sign-in account policy (`recordSignInFailure`) and raises `TotpInvalid`; a valid code refunds the units; a missing encryption key raises `TwoFactorUnavailable`.
- Then one unit of work: `userDeletion.deleteIfCredentialsVersion(user.id, user.credentialsVersion)`; false (the account or its credentials changed meanwhile) raises `Unauthenticated` and deletes nothing. The cascade ends every session, so every token stops working at once.
- The route answers 204, clears the session cookies and the grant cookie, and logs the user id, session id, IP and request id only (never the email, the password, a code or the grant).
- Not removed in the transaction: `auth_attempts` rows keyed by the email or IP (purged by the worker after 24 hours; not in the PRD's list).
- The erasure guard (`user-erasure.test.ts`): a registry of the tables that store user data with one seeder each (today `accounts`, `one_time_tokens`, `sessions`, `user_identities`, `user_two_factor`, `recovery_codes`, `sign_in_challenges`, `oauth_states` and `deletion_grants`); a recursive query over `pg_constraint` finds every table reachable from `users` through foreign keys; the test fails when a reachable table is not in the registry or a foreign key in the graph is not `ON DELETE CASCADE`. Tables that register later (DISC-001-02b `categories`, DISC-001-07a, and the movements of PRD 03 that reference `accounts`) need an entry with a seeder, so the guard makes erasure a conscious choice for every new module; what happens to group-shared records is decided by PRD 05.

**API contract**
- `POST /profile/delete` — Auth: `requireSession` (not `requireVerifiedEmail`: an unverified user can delete their own data). Request body: `deleteAccountRequestSchema` (`password?`, `secondFactorCode?`) plus the grant cookie `__Secure-argent_del` for password-less accounts (Block 4). Response: `204` with no body, the session cookies and the grant cookie cleared. Error codes: 400 `VALIDATION_FAILED` (oversized or malformed input), 400 `TOTP_INVALID` (second factor missing, wrong or used), 401 `INVALID_CREDENTIALS` (wrong or missing password), 401 `REAUTHENTICATION_REQUIRED` (password-less account without a live grant), 401 `UNAUTHENTICATED` (no session, or the account changed during the check), 429 `RATE_LIMITED`, 503 `TWO_FACTOR_UNAVAILABLE`.
- `GET /profile` (modified) — Response: `profileResponseSchema` with `deletionReauth`.

**Data model**
- No schema change in this block: it deletes a row of `users` (primary key `id`) and relies on the existing foreign keys with `ON DELETE CASCADE` (checked by the erasure guard); `email_outbox` has no foreign key to `users`, so its rows are removed explicitly by Block 2's repository; `profiles` reads `password_hash is not null` without returning the hash.

**Input validation**
- Body validated by `deleteAccountRequestSchema` (Block 1) through the shared `validate` middleware; the user id and session id come from the session, never from the request.

**Error handling**
- Wrong password → 401 `INVALID_CREDENTIALS`, the account stays, one unit stays in each sign-in policy.
- Missing password for an account with one → 401 `INVALID_CREDENTIALS`, nothing reserved.
- Over the sign-in limits → 429 `RATE_LIMITED` before any hashing, the account stays.
- Second factor missing, wrong or used → 400 `TOTP_INVALID`, the account stays; over the second-factor limit → 429 without checking the code.
- No session, or the credentials version changed during the check → 401 `UNAUTHENTICATED`, the account stays.
- Missing encryption key for 2FA → 503 `TWO_FACTOR_UNAVAILABLE`; a database failure → 500 `INTERNAL` and the single transaction deletes nothing.

**Required tests**
- [ ] with the right password and no 2FA the account is deleted, the answer is 204, and the old access and refresh cookies answer 401 afterwards — validates AC-01
- [ ] after deletion the same email and password no longer sign in, registering the email creates a new account, and another user's rows are untouched — validates AC-01
- [ ] zero rows: after deleting a user seeded with a row in every registered table (an account of DISC-001-02a, a session, a one-time token, a Google identity, 2FA secret and recovery codes, a sign-in challenge, an OAuth state, a grant) each table has 0 rows for the user id, and the user's `email_outbox` rows are gone — validates NFR-01, AC-01
- [ ] guard: every table reachable from `users` through foreign keys is in the registry, and a table created in the test with a foreign key to `users` (or to a registered table) and no registry entry makes the guard fail (error, sad path); a foreign key that is not `ON DELETE CASCADE` also fails it — validates NFR-01
- [ ] a wrong password answers 401 `INVALID_CREDENTIALS`, nothing is deleted, and the `sign_in_account` counter rises by one — validates AC-02 (sad path)
- [ ] 5 wrong passwords make the 6th delete attempt, and a password sign-in for that email, answer 429 without hashing — validates AC-02, NFR-02 (sad path)
- [ ] a user with 2FA deleting with the right password and a valid TOTP code, and with a valid recovery code (which is then spent), is deleted — validates AC-03
- [ ] a user with 2FA deleting without a code, with a wrong code, with a replayed TOTP code and with a used recovery code gets 400 and keeps the account, and a wrong code is counted (error, sad path) — validates AC-04
- [ ] the 6th wrong second-factor code within 15 minutes answers 429 without checking the code, and the 21st within 24 hours does too (sad path) — validates AC-05, NFR-02
- [ ] a user with both a password and a Google link must send the password: a live grant cookie does not delete the account (sad path) — validates AC-10
- [ ] a request without a session answers 401; an oversized password and a malformed code answer 400 and reserve nothing (sad path) — validates AC-02
- [ ] a password reset that lands between the password check and the delete makes the delete answer 401 and keeps the account (race, sad path) — validates AC-01
- [ ] two parallel delete requests with the right password delete the account once and the second answers 401 (race) — validates AC-01
- [ ] a pending verification email of the deleted user is gone from `email_outbox` and the worker sends nothing to the address — validates AC-01
- [ ] the log lines of a deletion contain the user id and no email, password, code or grant — validates AC-01
- [ ] `GET /profile` reports `deletionReauth: 'password'` for a user with a password and `'google'` for one without — validates FR-01

**Completion criterion**
All tests above pass; the erasure guard passes against the migrated schema; `pnpm test` passes in full.

## Block 4 — Google re-authentication and the deletion grant

**Files**
- `apps/api/src/identity/application/start-deletion-reauth.ts` (new) — `StartDeletionReauth`.
- `apps/api/src/identity/application/complete-deletion-reauth.ts` (new) — `CompleteDeletionReauth` (verifies the identity and issues the grant).
- `apps/api/src/identity/application/complete-google-sign-in.ts` (modified) — after consuming the state and verifying the ID token, a `delete_account` state goes to `CompleteDeletionReauth` instead of the account resolution; a `sign_in` state behaves exactly as before; the result type gains `deletion_grant_issued` and the failure reasons gain `reauth_identity_mismatch`.
- `apps/api/src/identity/application/delete-user.ts` (modified) — the password-less path checks the grant (`findLive`, then consumed in the deletion transaction).
- `apps/api/src/identity/application/ports/google-identity-provider.ts` (modified) — `GoogleAuthorizationRequest.reauthenticate?: boolean`; `GoogleClaims.authTime: number | null`.
- `apps/api/src/identity/infrastructure/security/google-oidc-identity-provider.ts` (modified) — with `reauthenticate` the authorization URL carries `prompt=login` and `max_age=0` (instead of `select_account`); the claims schema reads an optional `auth_time` and maps it.
- `apps/api/src/identity/infrastructure/http/profile-routes.ts` (modified) — adds `POST /profile/delete/google/start`.
- `apps/api/src/identity/infrastructure/http/google-routes.ts` (modified) — the callback handles `deletion_grant_issued` (sets the grant cookie, redirects to `…/settings/delete-account?reauth=ready`) and a failed re-authentication (redirects with `?reauth=failed`, no grant).
- `apps/api/src/identity/index.ts` (modified) — wires the two use cases.
- Tests and fixtures: `apps/api/test/fixtures/fake-google-oidc.ts` (modified: `auth_time` in the ID token when the request asked for `max_age`, a login hint to choose the identity), `apps/api/test/identity/deletion-reauth.test.ts` (new), `google-oidc-identity-provider.test.ts`, `fake-google-oidc.test.ts`, `google-sign-in.test.ts` (the sign-in flow is unchanged), `delete-user.test.ts` (the grant path), and the `GoogleClaims` literals that need `authTime: null` (`google-sign-in-races.test.ts`, `two-factor-enrollment.test.ts`).

**Logic**
- `StartDeletionReauth.execute({ userId, sessionId, ip })`: records one unit of `GOOGLE_START_IP_POLICY` (429 over the limit); loads the user, refuses one with a password (400 `VALIDATION_FAILED`, A-5); generates state, binding, nonce and verifier like `StartGoogleSignIn`; builds the authorization URL with `reauthenticate: true`; stores the state with purpose `delete_account`, the user id and the session id (the user's time zone and language fill the existing columns); returns the URL and the binding for the cookie.
- Callback: the existing checks run first (repeated parameters, state, binding cookie, expiry, `error` from Google, code, token exchange with signature, audience, issuer, expiry and nonce). For `delete_account`: `CompleteDeletionReauth` requires that Google's `sub` is linked to exactly the state's user (`identities.findUserByProviderSubject('google', sub)` returns that user), that `auth_time`, when present, is not older than the state's `createdAt` minus 60 seconds (a stale or future-dated value refuses), and that the user's session (`sessions.findById(state.sessionId)`) is still live; then it issues the grant: 32 random bytes (only the SHA-256 hash is stored), `replace` for the user, expiry `now + DELETION_GRANT_TTL_MS` (5 minutes), the user's current credentials version. Every refusal is one outcome answered the same way, without a grant.
- A `delete_account` state is never usable for signing in: the branch is chosen by the stored purpose, so no account is resolved, linked or created from it; and a `sign_in` state never reaches the grant path.
- `DeleteUser` (password-less user): reads the grant cookie, `findLive(hash, userId, sessionId, credentialsVersion, now)`; none gives `ReauthenticationRequired` (401, nothing reserved); then the second factor when enabled (as in Block 3); then in the deletion transaction `deletionGrants.consume(...)` (false gives `ReauthenticationRequired`, the grant is used up only when the deletion happens) and `deleteIfCredentialsVersion`. A wrong second-factor code leaves the grant valid until it expires.
- Logging: the start and the callback log user id, session id, IP, request id and the outcome or reason, never the code, state, binding, tokens, claims or grant.

**API contract**
- `POST /profile/delete/google/start` — Auth: `requireSession`. Request body: empty object (`emptyRequestSchema`). Response: `200 { authorizationUrl }` with `Cache-Control: no-store`, and the binding cookie `__Secure-argent_oauth` set (`Lax`, path `/auth/google`, 10 minutes) as in the sign-in flow. Error codes: 400 `VALIDATION_FAILED` (the user has a password), 401 `UNAUTHENTICATED`, 429 `RATE_LIMITED`, 500 `INTERNAL` (Google not configured).
- `GET /auth/google/callback` (modified) — Auth: none (the browser arrives from Google; the state and the binding cookie authenticate the flow). For a `delete_account` state: 302 to `{WEB_BASE_URL}/{language}/settings/delete-account?reauth=ready` with the grant cookie (`__Secure-argent_del`, `Strict`, `HttpOnly`, path `/profile/delete`, 5 minutes) on success, and to `?reauth=failed` without a cookie on any failure. The sign-in behaviour is unchanged.
- `POST /profile/delete` (modified) — see Block 3; password-less accounts use the grant cookie.

**Data model**
- No schema change in this block: it uses the `oauth_states` columns and the `deletion_grants` table created by migration `0010` in Block 2; no new table, constraint or index.

**Input validation**
- The start takes no input; the callback parameters keep the existing `googleCallbackQuerySchema` and the single-use state; the grant token is a 256-bit cookie value hashed before any lookup.

**Error handling**
- Google fails, is cancelled, or the token exchange or ID-token verification fails → redirect with `?reauth=failed`, no grant, nothing deleted.
- Google authenticates a different Google account than the one linked to the user → redirect with `?reauth=failed`, no grant.
- An unknown, used or expired state, or a binding cookie that does not match → the existing sign-in failure behaviour for a spent state (no grant); a stale `auth_time` → `?reauth=failed`.
- The session that started the flow was revoked meanwhile → no grant.
- A grant that is missing, expired, already used, or issued to another user or session → 401 `REAUTHENTICATION_REQUIRED` on `POST /profile/delete`, nothing deleted.

**Required tests**
- [ ] `POST /profile/delete/google/start` for a password-less user answers 200 with an authorization URL carrying `prompt=login` and `max_age=0` and sets the binding cookie, and the stored state has purpose `delete_account` with the user and session — validates AC-06
- [ ] the start for a user with a password answers 400 and stores nothing; without a session it answers 401 and over the limit 429 (sad path) — validates AC-10
- [ ] the callback of a `delete_account` state with the linked Google account issues a grant, sets the grant cookie, redirects to `?reauth=ready`, and the grant is bound to that user and session — validates AC-06
- [ ] the callback with a different Google account, a Google error, an unknown, used or expired state, a wrong binding cookie, a stale `auth_time`, or a revoked session issues no grant and redirects with `?reauth=failed` (error, sad path) — validates AC-07
- [ ] a Google ID token without `auth_time` is accepted when the state is fresh, and one with `auth_time` older than the state is refused — validates NFR-04
- [ ] a `delete_account` state never signs anyone in or creates an account, and a `sign_in` state never issues a grant (sad path) — validates AC-07
- [ ] a password-less user with a valid grant deletes the account, the grant is consumed, and the session cookies and the grant cookie are cleared — validates AC-08
- [ ] a password-less user with 2FA needs a valid second factor as well: a wrong code gets 400, keeps the account and keeps the grant valid until it expires (sad path) — validates AC-08, AC-04
- [ ] an expired grant, a used grant, a grant of another user and a grant of another session answer 401 `REAUTHENTICATION_REQUIRED` and delete nothing (error, sad path) — validates AC-09
- [ ] a missing grant cookie answers 401 `REAUTHENTICATION_REQUIRED` for a password-less user (sad path) — validates AC-09
- [ ] two parallel deletions with one grant delete once and the second answers 401 (race) — validates AC-09
- [ ] the log lines of the start, the callback and the deletion contain no code, state, binding, token, claim or grant — validates NFR-04
- [ ] the OIDC adapter builds `prompt=login` and `max_age=0` only for re-authentication, keeps `select_account` for sign-in, and maps `auth_time` to `GoogleClaims.authTime` or null — validates NFR-04
- [ ] the fake OIDC server issues `auth_time` when `max_age` was requested and lets a test choose the identity — validates NFR-04
- [ ] the existing Google sign-in tests (new account, link, supersede, repeat, second factor) pass unchanged — validates FR-04

**Completion criterion**
All tests above pass; the Google sign-in suite passes unchanged in behaviour; the full API suite is green.

## Block 5 — Web: delete-account screen

**Files**
- `apps/web/src/lib/api-client.ts` (modified) — `deleteAccount(body)` (`POST /profile/delete`, 204) and `startDeletionReauth()` (`POST /profile/delete/google/start`); `REAUTHENTICATION_REQUIRED` maps to a message key.
- `apps/web/src/features/profile/components/delete-account-form.tsx` (new) — the warning, and the password field (password path), the second-factor code field (when 2FA is on) and the destructive submit.
- `apps/web/src/features/profile/components/delete-account-google.tsx` (new) — the "Continue with Google to confirm" step.
- `apps/web/src/features/profile/containers/delete-account-container.tsx` (new).
- `apps/web/src/app/[locale]/(app)/settings/delete-account/page.tsx` (new).
- `apps/web/src/features/profile/components/profile-form.tsx` or the profile page (modified) — a link to the delete-account screen.
- `apps/web/messages/en.json` and `apps/web/messages/es.json` (modified) — namespace `deleteAccount` and the new error keys, in both languages.
- Tests: `apps/web/test/delete-account-container.test.tsx`, `delete-account-components.test.tsx`, `delete-account-i18n.test.tsx` (new), `api-client.test.ts`, `profile-container.test.tsx` and `profile-components.test.tsx` (the profile fixtures carry `deletionReauth`), `i18n-catalogs.test.ts`; `apps/web/e2e/delete-account.spec.ts` (new).

**Logic**
- The container loads `GET /profile` for `deletionReauth` and `twoFactorEnabled`. Password path: one form with the password, the second-factor code when 2FA is enabled, a warning that deletion is permanent and the destructive button; on 204 it navigates to `/sign-in`. Google path: the first step button calls `startDeletionReauth` and sends the browser to the returned URL (`window.location.assign`); when the page loads with `?reauth=ready` it shows the final form (the second-factor code when 2FA is enabled, the destructive button) and submits `POST /profile/delete` with no password; `?reauth=failed` shows the failure message and the button again.
- Errors map to messages: wrong password (`invalidCredentials`), wrong or missing code (`codeInvalid`), expired or missing re-authentication (`reauthenticationRequired`, offering to start again), too many attempts (`retryLater`), network (`network`). The password and the code are not kept after submit and never logged or put in a URL.
- Strings come from the catalogs, colors and spacing from theme tokens, components are the owned `components/ui` ones; the container fetches, the components are pure.

**API contract**
- Consumes the endpoints of Blocks 3 and 4 and creates none. Method and path: `GET /profile`, `POST /profile/delete` and `POST /profile/delete/google/start`, sent with `credentials: 'include'` and `X-Requested-With: argent`. Request: the JSON body of `deleteAccountRequestSchema` and an empty body for the start. Response: `profileResponseSchema`, no body (204) for the deletion and `startDeletionReauthResponseSchema` for the start, parsed with the shared schemas (a body that does not parse becomes `INTERNAL`). Error codes handled: `VALIDATION_FAILED`, `INVALID_CREDENTIALS`, `TOTP_INVALID`, `REAUTHENTICATION_REQUIRED`, `UNAUTHENTICATED`, `RATE_LIMITED`, `NETWORK`, `INTERNAL`. Auth: the session cookies (HttpOnly), refreshed once through `POST /auth/refresh` on 401, and the grant cookie that the browser sends by itself to `/profile/delete`.

**Input validation**
- Client-side mirror of Block 1: the password is 1 to 128 characters, the code is a 6-digit code or a recovery code; the API remains the authority.

**Error handling**
- A wrong password, a wrong second factor, an expired grant and a rate limit show their message and keep the user on the screen; the password and the code fields are cleared.
- A network failure shows the retry message and the form can be resubmitted; a 401 on load goes through the client's refresh once, then to sign-in.
- A failed Google re-authentication shows the failure message and the first-step button.

**Required tests**
- [ ] the password path posts the password (and the code when 2FA is on) and navigates to sign-in on 204 — validates AC-01, AC-03
- [ ] a wrong password, a wrong second-factor code, a rate limit and a network failure show their message, keep the user on the screen and clear the sensitive fields (sad path) — validates AC-02, AC-04, AC-05
- [ ] the Google path shows the first step, starts the re-authentication and goes to the returned URL; with `?reauth=ready` it shows the final form and deletes with no password — validates AC-06, AC-08
- [ ] with `?reauth=failed` it shows the failure message and the first step again, and an expired grant (401 `REAUTHENTICATION_REQUIRED`) offers to start again (sad path) — validates AC-07, AC-09
- [ ] a user with a password never sees the Google step — validates AC-10
- [ ] the English and Spanish catalogs have the same keys for the new namespace and no string is hard-coded in the new components — validates FR-01
- [ ] the API client sends `POST /profile/delete` and `POST /profile/delete/google/start` with credentials and the `X-Requested-With` header and maps `REAUTHENTICATION_REQUIRED` to its message key; an invalid response body becomes `INTERNAL` (sad path) — validates FR-01
- [ ] Playwright: a verified user with a password deletes the account with a wrong password first (kept) and then the right one (signed out, cannot sign in again) — validates AC-01, AC-02
- [ ] Playwright: a user with 2FA needs the code: a wrong code keeps the account and a valid one deletes it — validates AC-03, AC-04
- [ ] Playwright: a Google-created user starts the re-authentication, returns with `?reauth=ready`, confirms and is deleted, and the fake Google server saw `prompt=login` — validates AC-06, AC-08

**Completion criterion**
All tests above pass, including `pnpm e2e` for the new spec; the screen works in light and dark themes at phone width; `pnpm lint`, `pnpm typecheck` and the coverage floor of 80% hold.

## Rollback and reverse migration
The only schema change is `0010_account_deletion`. Rollback: stop the API and the email worker, run
`apps/api/drizzle/rollback/0010_account_deletion.down.sql` as a whole (it deletes the
`delete_account` OAuth states and every grant, drops the table and the three columns, and forgets the
migration), then revert the commit. The new routes and screens are additive and disappear with the
revert. Account deletion is irreversible by design (PRD, Out of Scope): a revert cannot restore
deleted accounts, so the route should not be enabled in an environment before Block 3's tests pass.

## Final verification
- A user with a password deletes with it; a user with 2FA also needs a valid second factor; a user without a password re-authenticates with Google through a single-use, 5-minute grant bound to user and session; each of the PRD's 10 acceptance criteria has at least one passing test.
- After a deletion no row of the user remains in any registered table (accounts included), the erasure guard fails for an unregistered or non-cascading table, and the user's outbox rows are gone.
- `pnpm test`, `pnpm e2e`, `pnpm test:perf`, `pnpm lint`, `pnpm typecheck` and `pnpm audit --prod --audit-level high` pass; coverage stays at or above 80% lines, branches and functions.
- No UI string is hard-coded, no secret, code or grant is logged, and no new runtime dependency was added.
- Open decisions O-1 and O-2 and assumptions A-1 to A-8 are accepted or changed in a new loop before the branch is merged; the `auth_time` behaviour is checked once with a real Google account.
