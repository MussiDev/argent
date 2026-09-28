# Spec DISC-001-01b: Google Sign-In

| Field | Value |
|-------|-------|
| Ticket | DISC-001-01b |
| PRD | docs/ddw/prd/prd-DISC-001-01b.md |
| Tier | FEATURE |
| Date | 2026-09-28 |
| Spec loops | 4 |
| Loops since last human decision | 2 |

## Summary
Adds Google sign-in to the `identity` module built in DISC-001-01a. The API runs the OpenID Connect
authorization code flow with PKCE as a confidential client: `GET /auth/google/start` stores a
single-use OAuth state row in PostgreSQL, binds it to the browser with a short-lived cookie and
redirects to Google; `GET /auth/google/callback` consumes that state, exchanges the code, verifies
the ID token (signature, audience, issuer, expiry, nonce) and then signs in, links, supersedes or
creates the account in one transaction, issuing the same session cookies as a password sign-in.
Only Google-verified emails are ever used, and an existing account is linked or superseded only when
Google is authoritative for the email (`gmail.com` or a Workspace `hd` claim). No Google script runs
in the web app: the button is a plain link to the API, so the web CSP does not change and the client
secret never leaves the API. Block 1 adds the persistence; Block 2 the Google adapter and a local
fake OIDC server for tests; Block 3 the use cases and routes; Block 4 the web button and messages.

## Coverage: PRD → blocks
| Requirement | Covered by |
|---|---|
| FR-01 | Block 1, Block 3, Block 4 |
| FR-02 | Block 1, Block 3, Block 4 |
| FR-03 | Block 1, Block 3 |
| FR-04 | Block 1, Block 3 |
| FR-05 | Block 1, Block 3 |
| FR-06 | Block 3, Block 4 |
| FR-07 | Block 1, Block 2, Block 3 |
| NFR-01 | Strategy: the callback does one token-endpoint call (2 s timeout) and verifies the ID token against a JWKS cached in memory by `jose` (public keys only, refetched on unknown `kid`), then one transaction of indexed lookups; no email-provider call in the request path. A benchmark in `apps/api/test/perf/` seeds OAuth states directly through the repository (the start rate limit would otherwise cap it), runs 200 callbacks against the fake OIDC server with 150 ms simulated token-endpoint latency and asserts p95 < 500 ms (Block 3). |
| NFR-02 | Strategy: `GoogleIdentityProvider.exchangeCode` returns claims only after `jose.jwtVerify` checks the RS256 signature against Google's JWKS, `aud` = `GOOGLE_CLIENT_ID` (and `azp` = `GOOGLE_CLIENT_ID` when `aud` is an array), `iss` ∈ {`https://accounts.google.com`, `accounts.google.com`} in production (the configured `GOOGLE_ISSUER` against the fake server), `exp`/`iat` with 60 s tolerance, and the `nonce` against the hash stored with the state (Block 2). Use cases receive only verified claims, so no path creates, links or signs in from an unverified token. Tests cover wrong signature, audience, issuer, expired token and nonce mismatch. |

## Dependencies between blocks
Block 1 → Block 2 → Block 3 → Block 4. Block 3 depends on the ports of Block 1 and the adapter and
fake server of Block 2; Block 4 depends on the routes of Block 3. Execution order: 1, 2, 3, 4.
FIX-001 (another session) modifies `sign-in.ts` and `refresh-session.ts`; if it merges first, this
branch is rebased onto it before Block 3.

## Justified new dependencies
None. The ID token is verified with `jose` (already a dependency, DISC-001-01a) and the token
endpoint is called with the platform `fetch`. The fake OIDC server for tests uses `node:http` and
`jose`.

## Block 1 — Google identities, OAuth states and password-less accounts

**Files**
- `apps/api/src/identity/infrastructure/db/schema.ts` (modified) — `users.password_hash` nullable; new tables `user_identities` and `oauth_states`; `auth_attempts_kind_check` gains `google_start_ip`.
- `apps/api/drizzle/0004_google_identity.sql` (new, generated), `apps/api/drizzle/meta/_journal.json` (modified), `apps/api/drizzle/meta/0004_snapshot.json` (new, generated).
- `apps/api/drizzle/rollback/0004_google_identity.down.sql` (new) — see Data model.
- `apps/api/src/identity/application/ports/user-repository.ts` (modified) — `User.passwordHash: string | null`; `NewUser.passwordHash: string | null`; `NewUser.emailVerifiedAt?: Date`; new `supersedeUnverified(id, at): Promise<User | null>`.
- `apps/api/src/identity/application/ports/user-identity-repository.ts` (new) — `findUserByProviderSubject(provider, subject): Promise<User | null>` (one statement joining `user_identities` and `users`, so the credentials version is read together with the identity), `hasProviderIdentity(userId, provider)`, `link({ userId, provider, subject, emailAuthoritative })` (rejects with `IdentityAlreadyLinked` on either unique constraint), `deleteNonAuthoritativeForUser(userId)`.
- `apps/api/src/identity/application/ports/oauth-state-repository.ts` (new) — `create(state)`, `consume(stateHash, bindingHash, now): Promise<OAuthState | null>`.
- `apps/api/src/identity/application/ports/oauth-state-purger.ts` (new) — `purgeExpired(now): Promise<number>`, mirroring `attempt-purger.ts`.
- `apps/api/src/identity/application/ports/attempt-limiter.ts` (modified) — attempt kind `google_start_ip`.
- `apps/api/src/identity/application/ports/unit-of-work.ts` (modified) — `TransactionalRepositories.identities`.
- `apps/api/src/identity/domain/errors.ts` (modified) — `IdentityAlreadyLinked extends Error` (no HTTP code, like `DuplicateEmail`; a leak becomes 500).
- `apps/api/src/identity/infrastructure/db/drizzle-user-repository.ts` (modified), `drizzle-user-identity-repository.ts` (new), `drizzle-oauth-state-repository.ts` (new, implements both OAuth-state ports), `drizzle-unit-of-work.ts` (modified) — all under `apps/api/src/identity/infrastructure/db/`.
- `apps/api/src/identity/infrastructure/email/email-worker.ts` (modified) — the retention purge also calls `OAuthStatePurger.purgeExpired`.
- `createEmailWorker` in `apps/api/src/identity/index.ts` (modified) — builds the worker from `db`, so it wires the Drizzle `OAuthStatePurger` there; its callers (`apps/api/src/worker.ts`, `apps/api/test/helpers/identity-harness.ts`, `apps/api/test/identity/email-worker-retry.test.ts`) keep their signature.
- `apps/api/src/identity/index.ts` (modified) — `IdentityInfrastructure` gains `identities`, `oauthStates`, `oauthStatePurger`; exports the new ports.
- Type-level fakes that must follow the port changes: `apps/api/test/identity/sign-in-use-case.test.ts` (`UserRepository` literal), `apps/api/test/identity/register-user.test.ts` (`UserRepository` literal and `work({...})` without `identities`), `apps/api/test/identity/refresh-session.test.ts`, `apps/api/test/identity/password-reset-use-cases.test.ts` (`work({...})`).
- `EmailWorker` construction sites: `apps/api/test/identity/email-worker.test.ts` (retention-purge tests), `apps/api/test/identity/email-worker-resilience.test.ts`.
- `apps/api/test/identity/identity-infrastructure.test.ts` (modified) — `toBeInstanceOf` cases for the new adapters.
- `apps/api/test/identity/migration.test.ts` (modified) — `IDENTITY_TABLES` gains `oauth_states` and `user_identities`; `ALL_MIGRATIONS` becomes 5; every rollback chain starts with `rollback('0004_google_identity')`.
- `apps/api/test/identity/google-persistence.test.ts` (new), `apps/api/test/identity/sign-in.test.ts` (modified).

**Logic**
- `supersedeUnverified(id, at)`: one `update users set password_hash = null, credentials_version = credentials_version + 1, password_changed_at = at, email_verified_at = at where id = $1 and email_verified_at is null returning *`; returns null when the account was verified meanwhile. Bumping the credentials version makes every existing session stale (DISC-001-01a mechanism); the caller also revokes them.
- `consume`: `delete from oauth_states where state_hash = $1 and binding_hash = $2 and expires_at > $3 returning *` — atomic and single-use; a wrong binding, an expired row or a second use all return null.
- Every hash (state, binding, nonce) is `TokenGenerator.hash` (hex SHA-256), the same as DISC-001-01a tokens.
- Password sign-in with a password-less user: `sign-in.ts` already falls back to the dummy hash when `passwordHash` is null (`??`); the answer is `invalid_credentials` and the reserved limiter units are kept. The block adds the test, not new logic.

**Data model**
- `users.password_hash text null` (was `not null`).
- `user_identities`: `id uuid pk default random`, `user_id uuid not null` fk `users` on delete cascade, `provider text not null` check in (`google`), `subject text not null`, `email_authoritative boolean not null`, `created_at timestamptz not null default now()`; unique `(provider, subject)`; unique `(user_id, provider)`.
- `oauth_states`: `state_hash text pk`, `binding_hash text not null`, `nonce_hash text not null`, `code_verifier text not null`, `time_zone text not null`, `language text not null` check in `LANGUAGES`, `created_at timestamptz not null default now()`, `expires_at timestamptz not null`; index on `expires_at`.
- `auth_attempts_kind_check` includes `google_start_ip`.
- Migration `0004_google_identity` adds tables, relaxes one constraint and widens one check; it is non-destructive.
- Rollback `0004_google_identity.down.sql` is **destructive** and says so in its header, like `0002`: it deletes `auth_attempts` rows of kind `google_start_ip`, restores the previous check, drops `oauth_states` and `user_identities` (losing every Google link, including those of password users) and restores `not null` on `password_hash`, which fails while any password-less user exists.

**Input validation**
- No HTTP input in this block. Repository inputs are typed; `provider` is a closed union.

**Error handling**
- Unique violation on `user_identities` — `IdentityAlreadyLinked` (handled by Block 3).
- Unique violation on `users.email` — `DuplicateEmail` (existing).

**Required tests**
- [ ] a user can be created without a password and with `emailVerifiedAt` set — validates FR-01, FR-03
- [ ] `link` stores a Google identity with its `emailAuthoritative` flag and `findUserByProviderSubject` returns its user; a second link of the same subject or a second Google identity for the same user rejects with `IdentityAlreadyLinked` — validates FR-02, FR-04, sad path
- [ ] `supersedeUnverified` clears the password, bumps the credentials version and marks the email verified; on an already verified user it returns null and changes nothing — validates FR-05, sad path
- [ ] `deleteNonAuthoritativeForUser` deletes only identities with `email_authoritative = false` — validates FR-07
- [ ] `consume` returns the state once; a second consume, a wrong binding hash and an expired row return null — sad path
- [ ] password sign-in for a password-less user returns 401 `INVALID_CREDENTIALS` with the same body as a wrong password — sad path
- [ ] the retention purge deletes expired `oauth_states` rows and keeps live ones
- [ ] migration `0004` applies on a database at `0003`; its rollback restores `0003` when no password-less user exists and removes `google_start_ip` attempt rows

**Completion criterion**
All tests above pass; `drizzle-kit check` is clean; the existing DISC-001-01a suite still passes.

## Block 2 — Google OpenID Connect adapter

**Files**
- `apps/api/src/identity/application/ports/google-identity-provider.ts` (new) — `authorizationUrl({ state, nonce, codeVerifier }): string` (the adapter derives the S256 challenge, since the application layer cannot import `node:crypto`); `exchangeCode({ code, codeVerifier, expectedNonceHash }): Promise<GoogleClaims>` with `GoogleClaims = { subject, email, emailVerified, hostedDomain: string | null }`; `GoogleSignInFailed extends Error` (carries an internal `reason` for logs only) lives in this port file because its reasons are transport-level.
- `apps/api/src/identity/domain/google-authority.ts` (new) — pure `isGoogleAuthoritative(email, hostedDomain)`: true for a `gmail.com` address or a non-null `hostedDomain` (PRD FR-07); `apps/api/test/identity/google-authority.test.ts` (new).
- `apps/api/src/identity/infrastructure/security/google-oidc-identity-provider.ts` (new) — the adapter.
- `apps/api/src/identity/infrastructure/security/unconfigured-google-identity-provider.ts` (new) — every call fails with `GoogleSignInFailed('not_configured')`.
- `apps/api/src/shared/config/env.ts` (modified) — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (optional outside production, required in production), `GOOGLE_AUTHORIZATION_URL`, `GOOGLE_TOKEN_URL`, `GOOGLE_JWKS_URL`, `GOOGLE_ISSUER` (default to Google's values; production rejects any other value).
- `apps/api/test/helpers/test-env.ts` (modified) — `productionOverrides` gains `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, so every existing production parse keeps passing.
- `apps/api/test/fixtures/fake-google-oidc.ts` (new) — local OIDC server on `node:http`: `/authorize` serves a consent page with a "Continue" link back to the callback carrying a code for the identity given in `login_hint` (`sub`, `email`, `email_verified`, optional `hd`) and a "Cancel" link carrying `error=access_denied`; integration tests follow the link's URL directly; `/token` checks the PKCE verifier and client credentials and returns an ID token signed with its own RS256 key (optionally with a wrong audience, issuer, nonce or expiry, and an optional delay); `/jwks` serves the public key.
- `apps/api/test/fake-google-oidc-server.ts` (new) — runnable entry for Playwright (like `test/e2e-database.ts`), listening on `127.0.0.1`.
- `apps/api/test/identity/google-oidc-identity-provider.test.ts` (new), `apps/api/test/foundation/env.test.ts` (modified).
- `.env.example` (modified by the user; the agent has no access) — the six `GOOGLE_*` variables with comments.

**Logic**
- `authorizationUrl`: `GOOGLE_AUTHORIZATION_URL` with `client_id`, `redirect_uri` = `${API_ORIGIN}/auth/google/callback`, `response_type=code`, `scope=openid email`, `state`, `nonce`, `code_challenge` = base64url(SHA-256(`codeVerifier`)), `code_challenge_method=S256`, `prompt=select_account`.
- `exchangeCode`: POST form to `GOOGLE_TOKEN_URL` with a 2 s `AbortSignal` timeout; take `id_token`; `jwtVerify` with `createRemoteJWKSet(GOOGLE_JWKS_URL)`, `algorithms: ['RS256']`, `audience`, the issuer set above, `clockTolerance: 60`; when `aud` is an array require `azp` = client id; parse the claims; compare `TokenGenerator.hash(nonce)` with `expectedNonceHash` in constant time; lower-case the email and parse it with the domain `Email`.
- The adapter returns the `hd` claim as `hostedDomain` (null when absent); it applies no business rule. The FR-07 authority rule is the domain function `isGoogleAuthoritative`, used by `CompleteGoogleSignIn`, so use-case tests with a fake provider exercise it. Google documents `email_verified` as authoritative only for `gmail.com` and Workspace (`hd`) accounts.
- The JWKS key cache lives in process memory; see the decision log for this exception to "no cache state in process memory".
- When `GOOGLE_CLIENT_ID` is unset outside production, the composition root uses `UnconfiguredGoogleIdentityProvider`.

**API contract**
No endpoint of ours; this block is the enabler of FR-01, FR-02, FR-04 and FR-07 (with the domain rule above) (every Google claim
they use comes from here). Outbound calls:
- Method + path: `POST GOOGLE_TOKEN_URL` (`https://oauth2.googleapis.com/token`)
- Request: `application/x-www-form-urlencoded` `{ grant_type: "authorization_code", code, code_verifier, redirect_uri, client_id, client_secret }`
- Response: 200 `{ id_token: string, ... }`; other fields ignored
- Error codes: any non-2xx, timeout (2 s) or malformed body → `GoogleSignInFailed`
- Auth: client credentials in the form body (confidential client)

- Method + path: `GET GOOGLE_JWKS_URL` (`https://www.googleapis.com/oauth2/v3/certs`)
- Request: none
- Response: 200 JWK set (RS256 public keys), cached by `jose`
- Error codes: unreachable or no key for the token's `kid` → `GoogleSignInFailed`
- Auth: none (public keys)

**Input validation**
- Token-endpoint response parsed with a Zod schema (`id_token` string ≤ 4096 chars); ID token claims parsed with a Zod schema after signature verification (`sub` 1–255 chars, `email` per the shared email schema, `email_verified` boolean, `nonce` 1–128 chars, `hd` optional 1–253 chars, `azp` optional).

**Error handling**
- Timeout, non-2xx, malformed JSON, missing `id_token`, bad signature, wrong `aud`/`azp`/`iss`, expired token, nonce mismatch, missing claims — all `GoogleSignInFailed` with a distinct internal reason; never logs the code, the tokens or the verifier.

**Required tests**
- [ ] a valid code from the fake server returns the subject, lower-cased email, `emailVerified` and `hostedDomain` (the `hd` claim, or null) — validates NFR-02
- [ ] `isGoogleAuthoritative` is true for a `gmail.com` address and for any email with a hosted domain, false for another domain without one — validates FR-07
- [ ] an ID token signed with another key is rejected — sad path, validates NFR-02
- [ ] wrong audience, wrong issuer, an array `aud` with a foreign `azp` and an expired ID token are each rejected — sad path, validates NFR-02
- [ ] a nonce that does not match the stored hash is rejected — sad path, validates NFR-02
- [ ] a wrong PKCE verifier (token endpoint 400) and a token endpoint slower than 2 s are rejected — sad path
- [ ] `authorizationUrl` carries `state`, `nonce`, the S256 challenge of the verifier, `scope=openid email` and the API callback as `redirect_uri`
- [ ] production env without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, or with a non-Google endpoint, fails to parse — sad path
- [ ] the unconfigured provider fails every call with `GoogleSignInFailed` — sad path

**Completion criterion**
All tests above pass without any request leaving the machine.

## Block 3 — Google sign-in use cases and routes

**Files**
- `apps/api/src/identity/application/start-session.ts` (new) — `StartSession` (creates the session row and access token) and the `SessionTokens` type, both moved out of `sign-in.ts`.
- `apps/api/src/identity/application/sign-in.ts` (modified) — uses `StartSession`; `SignInDependencies` replaces `sessions`, `tokenGenerator`, `accessTokens` and `clock` with `startSession`.
- `apps/api/src/identity/application/refresh-session.ts`, `apps/api/src/identity/infrastructure/http/session-cookies.ts` (modified) — import `SessionTokens` from `./start-session`.
- `apps/api/test/identity/sign-in-use-case.test.ts`, `apps/api/test/identity/reset-session-races.test.ts` (modified) — construct `SignIn` with the new dependencies.
- `apps/api/src/identity/application/start-google-sign-in.ts` (new) — `StartGoogleSignIn`.
- `apps/api/src/identity/application/complete-google-sign-in.ts` (new) — `CompleteGoogleSignIn`.
- `apps/api/src/identity/application/confirm-password-reset.ts` (modified) — in the reset transaction, `identities.deleteNonAuthoritativeForUser(userId)`.
- `packages/shared/src/auth/google.ts` (new) — `googleStartQuerySchema`, `googleCallbackQuerySchema`, `GOOGLE_SIGN_IN_ERRORS`; `packages/shared/src/index.ts` (modified) — `export * from './auth/google'`.
- `apps/api/src/shared/http/validate.ts` (modified) — `ResponseFacade.redirect(url)` (302 + `Location`); `apps/api/test/foundation/validate.test.ts` (modified).
- `apps/api/src/identity/infrastructure/http/google-routes.ts` (new) — both routes.
- `apps/api/src/identity/infrastructure/http/session-cookies.ts` (modified) — `OAUTH_BINDING_COOKIE` and its options.
- `apps/api/src/identity/index.ts` (modified) — wires the use cases, the provider (real or unconfigured) and the router; `IdentityModuleDependencies.env` gains the `GOOGLE_*` and `API_ORIGIN`/`WEB_BASE_URL` keys.
- `apps/api/test/helpers/identity-harness.ts` (modified) — starts the fake OIDC server for Google tests and passes its URLs through `options.env`.
- `apps/api/test/identity/google-sign-in.test.ts` (new), `apps/api/test/identity/google-sign-in-races.test.ts` (new), `apps/api/test/identity/password-reset.test.ts` (modified), `apps/api/test/perf/google-callback.perf.test.ts` (new).

**Logic**
- Start: record `google_start_ip` (20 per IP per 15 min) → resolve `timeZone`/`language` with `newAccountDefaults` (invalid values fall back to the defaults, as in registration) → generate `state`, `binding`, `nonce` and `codeVerifier` (32 random bytes each, base64url, through `TokenGenerator.generate`) → store `oauth_states` with the hashes of state, binding and nonce, the verifier, the resolved time zone and language, and `expires_at = now + 10 min` → return the authorization URL and the binding.
- Complete, in this order:
  1. Any query value given as an array, or a missing `state` or binding cookie → failure. Consume the state row (single use, bound to this browser, unexpired) → null is a failure.
  2. Google returned `error` (cancelled consent, AC-02) or no `code` → failure.
  3. `exchangeCode` → verified claims (NFR-02).
  4. `emailVerified = false` → failure, nothing written (AC-05, AC-08, FR-06).
  5. One `unitOfWork.run`:
     - identity `(google, sub)` exists → that user, read with `findUserByProviderSubject` in the same statement as the identity (AC-03);
     - else a user with the claim email exists:
       - `isGoogleAuthoritative(email, hostedDomain)` is false → failure, nothing written (AC-09, FR-07);
       - user verified → `link` (AC-06, FR-04);
       - user unverified → `supersedeUnverified`, `sessions.revokeAllForUser`, `link` (AC-07, FR-05); if `supersedeUnverified` returns null the user was verified meanwhile → `link`;
     - else create the user without a password, with the state's time zone and language and `emailVerifiedAt = now` (AC-01, AC-04), then `link` with `emailAuthoritative = isGoogleAuthoritative(email, hostedDomain)`.
  6. `StartSession` for the user, with the credentials version read after step 5.
- A `DuplicateEmail` or `IdentityAlreadyLinked` from a concurrent callback aborts the PostgreSQL transaction; step 5 is retried once as a **new** `unitOfWork.run`; a second conflict is a failure.
- A user who already has another Google identity linked and signs in with a second Google account carrying the same email → `hasProviderIdentity` is checked before linking → failure with internal reason `another_identity_linked` (one Google identity per account); the unique constraint still backs it up.
- Password reset: `ConfirmPasswordReset` deletes the user's non-authoritative Google identities in its transaction. A reset proves current control of the mailbox, which outranks a Google claim that is not authoritative for that email, so whoever held that Google account loses access (threat R-37).
- Expected failures (steps 1–5) are an outcome of the use case, not exceptions, and become the failure redirect, logged at `warn` with the internal reason. Unexpected errors (database or network faults outside the provider) are not caught: they reach the error middleware, are logged at `error` and answer 500.

**API contract**
- Method + path: `GET /auth/google/start`
- Request: query `{ timeZone?: string, language?: string }` bounded by `TIME_ZONE_INPUT_MAX_LENGTH` and `LANGUAGE_INPUT_MAX_LENGTH` (the registration constants); an empty value counts as missing.
- Response: 302 `Location: <Google authorization URL>`; sets `__Secure-argent_oauth` = binding (`HttpOnly; Secure; SameSite=Lax; Path=/auth/google; Max-Age=600`).
- Error codes: 400 `VALIDATION_FAILED` for a value over its length limit or a repeated parameter (the web app never sends either); 302 to `${WEB_BASE_URL}/{language}/sign-in?error=google_failed` when rate-limited or Google sign-in is not configured.
- Auth: public; safe method, so the `Origin` guard does not apply; reached by top-level navigation from the web app.

- Method + path: `GET /auth/google/callback`
- Request: query `{ code?, state?, error?, error_description?, scope?, authuser?, prompt?, hd?, iss? }`, each a string of at most 2048 chars (an empty value counts as missing) or an array of at most 5 such strings (an array is treated as a failure, never as a 400); cookie `__Secure-argent_oauth`.
- Response: success → 302 `${WEB_BASE_URL}/{user.language}`, sets the DISC-001-01a session cookies and clears `__Secure-argent_oauth`. Failure → 302 `${WEB_BASE_URL}/{language}/sign-in?error=google_failed`, where `{language}` is the consumed state's language, else `es`; clears `__Secure-argent_oauth` and sets no session cookie.
- Error codes: 400 `VALIDATION_FAILED` only for a string over 2048 chars or an array of more than 5 values (neither is sent by Google); 500 `INTERNAL` for an unexpected fault; every expected failure is the redirect above.
- Auth: public; the binding cookie is `SameSite=Lax` because Google's redirect is a cross-site top-level navigation that does not carry `Strict` cookies.

**Data model**
- No schema change beyond Block 1; this block reads and writes `users`, `user_identities`, `oauth_states`, `sessions` and `auth_attempts` (kind `google_start_ip`, whose check constraint Block 1 widens).

**Input validation**
- `googleStartQuerySchema`: `timeZone` and `language` bounded by `TIME_ZONE_INPUT_MAX_LENGTH` and `LANGUAGE_INPUT_MAX_LENGTH` imported from `register.ts`, so the two schemas cannot drift; values are resolved by `newAccountDefaults`, so only valid values are stored. `googleCallbackQuerySchema`: the fields above as `string | string[]` with at most 2048 chars per string and at most 5 array items, empty strings treated as missing; unknown parameters are stripped, never rejected, because Google may add parameters. `state` is only compared through its hash; the code is only forwarded to the token endpoint.

**Error handling**
- Missing, reused, expired or foreign state; missing binding cookie; array query values; Google `error`; exchange or verification failure; unverified Google email; non-authoritative email matching an account; a second Google identity for one account; repeated conflict — all redirect to sign-in with `error=google_failed` (AC-02, AC-05, AC-08, AC-09) and create or link nothing.
- No log line contains the code, tokens, state, binding, verifier or email.

**Required tests**
- [ ] start redirects to the authorization URL, stores one `oauth_states` row with hashes only for state, binding and nonce and the resolved time zone and language, and sets the binding cookie with `SameSite=Lax`, `Path=/auth/google` — validates FR-01
- [ ] callback for a new `gmail.com` email with `email_verified = true` creates a verified, password-less user linked to the Google subject, with the state's time zone and language, enqueues no verification email, sets the session cookies and redirects to the app — validates AC-01, AC-04
- [ ] callback for a new verified email of another domain creates the user with a non-authoritative identity — validates AC-01, FR-07
- [ ] callback with `error=access_denied` redirects to sign-in with `error=google_failed` and creates no user — validates AC-02, sad path
- [ ] callback for an already linked subject signs in to the existing user, redirects to the user's language and creates no user — validates AC-03
- [ ] callback with `email_verified = false` and no matching account creates nothing and redirects with `error=google_failed` — validates AC-05, sad path
- [ ] callback with an authoritative verified email matching a verified password account links it, starts a session on it, and the password still signs in — validates AC-06
- [ ] callback with an authoritative verified email matching an unverified password account removes the password, revokes its existing sessions (401 on their next use), marks it verified, links it and starts a session; the old password now answers 401 `INVALID_CREDENTIALS` — validates AC-07
- [ ] callback with `email_verified = false` matching an existing account redirects with `error=google_failed`, links nothing and leaves the account unchanged — validates AC-08, sad path
- [ ] callback with a verified but non-authoritative email matching an existing account redirects with `error=google_failed`, links nothing and leaves the account unchanged — validates AC-09, sad path
- [ ] a password reset removes the user's non-authoritative Google identity (the next Google callback for it is refused) and keeps an authoritative one — validates FR-07
- [ ] callback without the binding cookie, with another browser's binding, with a reused state, with a state older than 10 minutes and with a repeated `code` parameter each redirect with `error=google_failed` — sad path
- [ ] callback whose ID token fails verification (fake server wrong audience) redirects with `error=google_failed` and creates nothing — validates NFR-02, sad path
- [ ] a Google account whose email matches a user already linked to another Google subject is refused — sad path
- [ ] two concurrent callbacks for the same new Google subject create exactly one user and one identity — sad path
- [ ] a password reset that commits right after the identity lookup leaves no live session for the evicted non-authoritative identity — sad path, validates FR-07
- [ ] a callback whose use case throws answers 500 and still clears the binding cookie — sad path
- [ ] the 21st start from one IP within 15 minutes redirects with `error=google_failed` and stores no state — sad path
- [ ] a start query value over its length limit answers 400 `VALIDATION_FAILED`; an unknown time zone or language is stored as the default — sad path
- [ ] a callback with an empty `hd=` or `state=` value is handled as missing (redirect, not 400) — sad path
- [ ] `ResponseFacade.redirect` answers 302 with the given `Location`
- [ ] no log line of a full flow contains the code, ID token, state, binding, verifier or email
- [ ] perf: callback p95 < 500 ms over 200 requests with 150 ms simulated token-endpoint latency — validates NFR-01

**Completion criterion**
All tests above pass against PostgreSQL and the fake OIDC server; the DISC-001-01a suite still
passes after the `StartSession` extraction.

## Block 4 — Web Google sign-in

**Files**
- `apps/web/src/lib/api-client-provider.tsx` (modified) — exposes the API origin through `useApiOrigin()`.
- `apps/web/src/features/auth/google-start-url.ts` (new) — builds `${apiOrigin}/auth/google/start?timeZone=…&language=…` from `device-context` and the active locale.
- `apps/web/src/features/auth/components/google-sign-in-button.tsx` (new) — presentational link rendered with the shadcn `Button` (`asChild`) and an inline Google mark (`aria-hidden`).
- `apps/web/src/features/auth/components/sign-in-form.tsx`, `register-form.tsx` (modified) — optional `googleStartUrl` prop rendering the button and an "or" divider.
- `apps/web/src/features/auth/containers/sign-in-container.tsx`, `register-container.tsx` (modified) — pass the start URL; the sign-in container reads `?error=google_failed` and shows the Google error.
- `apps/web/src/features/auth/form-errors.ts` (modified) — `ErrorMessageKey` gains `googleFailed`, so `FormAlert` renders it from the `errors` namespace.
- `apps/web/messages/es.json`, `apps/web/messages/en.json` (modified) — `auth.google.continue`, `auth.or`, `errors.googleFailed` ("Google sign-in failed. Please try again." / "No pudimos iniciar sesión con Google. Vuelve a intentarlo.", in the catalog's neutral tú form).
- `playwright.config.ts` (modified) — starts `apps/api/test/fake-google-oidc-server.ts` on `127.0.0.1` and passes the `GOOGLE_*` variables to the API.
- `apps/web/e2e/google.spec.ts` (new).
- `apps/web/test/google-sign-in-button.test.tsx`, `apps/web/test/google-start-url.test.ts` (new); `apps/web/test/sign-in-container.test.tsx`, `apps/web/test/register-container.test.tsx`, `apps/web/test/auth-error-messages.test.tsx`, `apps/web/test/auth-form-accessibility.test.tsx` (modified).

**Logic**
- The button is a top-level navigation to the API; no Google script is loaded in the web app, so the CSP stays as in DISC-001-01a.
- After the callback the browser lands on `/{language}`; the authenticated shell calls `GET /auth/session` as today.
- `?error=google_failed` shows `errors.googleFailed` in the sign-in form alert; the parameter is removed from the URL with `history.replaceState` so a reload does not repeat it.
- The fake OIDC server listens on `127.0.0.1` while web and API use `localhost`, and its consent page makes the test click a link, so the navigation back to the callback is initiated from another site, as with Google. A `Strict` binding cookie would not be sent on that navigation, so the e2e fails if the cookie is not `Lax` (an automatic redirect chain would not prove this, because Chromium does not apply SameSite to the redirect chain by default).

**API contract**
- No new endpoint. The button is a link to `GET /auth/google/start` (Block 3); the callback is Google → API.
- Request: top-level navigation with query `timeZone` (device) and `language` (active locale), per `googleStartQuerySchema` from `@argent/shared`.
- Response: the browser ends on `/{language}` (signed in) or on `/{language}/sign-in?error=google_failed`.
- Error codes: `google_failed` in the sign-in URL (the only value in `GOOGLE_SIGN_IN_ERRORS`), mapped to `errors.googleFailed`.
- Auth: none to start; the API sets the session cookies on the callback, and later requests send them with `credentials: 'include'` as in DISC-001-01a.

**Input validation**
- The `error` query value is compared with `GOOGLE_SIGN_IN_ERRORS`; any other value is ignored.

**Error handling**
- `google_failed` → `errors.googleFailed` (AC-02, AC-05, AC-08, AC-09). No other Google error reaches the web app.

**Required tests**
- [ ] e2e: new Google user (verified `gmail.com`) → lands in the app signed in → sign-out — validates AC-01, AC-04
- [ ] e2e: cancelling at the fake Google screen returns to sign-in with the Google error message — validates AC-02, sad path
- [ ] e2e: the callback navigation starts from the fake consent page on `127.0.0.1` and completes the sign-in, proving the binding cookie crosses sites as `SameSite=Lax`
- [ ] e2e: the same Google user signing in again reaches the same account — validates AC-03
- [ ] e2e: a Google user with an unverified email sees the Google error and no account is created — validates AC-05, sad path
- [ ] e2e: verified password account then Google with the same `gmail.com` email → same account, password still works — validates AC-06
- [ ] e2e: unverified password account then Google with the same verified `gmail.com` email → signed in; the old password is rejected — validates AC-07
- [ ] e2e: unverified Google email matching an existing account shows the Google error — validates AC-08, sad path
- [ ] e2e: verified non-authoritative Google email matching an existing account shows the Google error — validates AC-09, sad path
- [ ] component: the button renders the localized label and links to the start URL — validates FR-01
- [ ] component: sign-in container shows the Google error for `error=google_failed` and ignores unknown values — sad path
- [ ] unit: `google-start-url` includes the device time zone and the locale

**Completion criterion**
All e2e tests pass in CI with the fake OIDC server; both screens render the button in `/es` and `/en`.

## Final verification
- `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (80% lines, branches and functions), `pnpm test:perf` and `pnpm e2e` pass.
- Every FR-01..FR-07, NFR-01..NFR-02 and AC-01..AC-09 of the PRD maps to a passing test listed above.
- No test calls Google; no request leaves the machine.
- A database dump contains no Google token, authorization code, state or binding value.

## Decision log
- 2026-09-28: Server-side authorization code flow with PKCE instead of Google Identity Services (a Google script posting an ID token to the API). Keeps third-party script out of a financial app's pages and its CSP unchanged, keeps the flow standard OIDC with a confidential client, and lets tests replace Google with a local OIDC server through configuration only.
- 2026-09-28: OAuth state lives in PostgreSQL (`oauth_states`), not in process memory or a signed cookie, so any API instance can complete a flow started on another and every state is single-use by an atomic delete.
- 2026-09-28: The binding cookie is `SameSite=Lax` (the only non-`Strict` cookie): Google's redirect back is a cross-site top-level navigation. It carries only a random value whose hash must match the state row, which defeats login CSRF.
- 2026-09-28: The PKCE verifier is stored in plaintext for at most 10 minutes; alone it grants nothing (the code and the client secret are also needed), and the row is deleted on use or by the retention purge.
- 2026-09-28: Exception to "no cache state in process memory" (AGENTS.md, DISC-001-01a NFR-09): `jose`'s JWKS cache keeps Google's public signing keys in memory. It holds no user or session state, every instance fetches the same keys, and a cold instance verifies correctly after one fetch, so horizontal scaling is unaffected. Fetching the JWKS on every callback would add a network round trip against NFR-01.
- 2026-09-28: The Google mark is an inline SVG with Google's brand colours, an exception to "theme tokens only": Google's branding guidelines require those colours.
- 2026-09-28: The start query reuses the registration bounds and resolves invalid values to defaults (architecture review, option A), instead of a strict schema that would reject what registration accepts.
- 2026-09-28: A password reset on a password-less (Google-created) account sets its first password; proving control of the email is the same bar as registration.
- 2026-09-28: A password reset removes non-authoritative Google identities (FR-07 applied to the reset path): for those emails a Google claim is weaker than control of the mailbox, so a previous owner of the address keeps no Google access.
- 2026-09-28: PRD corrective loops (user decisions): a Google-verified email supersedes an unverified password account (AC-07); an unverified Google email never creates or links (AC-05, AC-08); linking and superseding require an authoritative email (AC-09).
- 2026-09-28: Architecture review and impact scan applied: `@argent/shared` root export instead of a nonexistent `/auth` subpath; flat web test paths; `apps/api/test/identity/migration.test.ts`; type-level fakes, `EmailWorker` construction sites and `test-env.ts` production overrides listed; `OAuthStatePurger` port; `TokenGenerator.hash` for every hash; S256 challenge computed in the adapter; `ResponseFacade.redirect`; retry as a new transaction; array query values as failures; redirect to the account's language; destructive rollback stated; fake OIDC server on `127.0.0.1` for a real cross-site redirect in e2e; perf test seeds states directly.
- 2026-09-28: Architecture review round 2 (PASSED) applied: FR-07 authority rule moved to the domain (`isGoogleAuthoritative`, provider returns `hostedDomain`); empty query values count as missing and arrays are capped; start query reuses the registration length constants; `createEmailWorker` wiring listed; the fake consent page makes e2e prove the `SameSite=Lax` binding cookie.
- 2026-09-28: Block 2 review follow-ups: `maxTokenAge: '1h'` makes `iat` required and rejects an `iat` in the future (beyond the 60 s tolerance); `GOOGLE_CLIENT_SECRET` is required whenever `GOOGLE_CLIENT_ID` is set, in any environment; the JWKS fetch times out after 2 s; the token-endpoint body is read with a 16 KB limit before JSON parsing.
- 2026-09-28: Block 3 architecture review (FAIL fixed): the existing-identity path read the identity and the user in two statements, so a password reset committing in between could leave a live session to the Google identity it removed (R-37). Block 1's port changes from `findUserIdByProviderSubject` to `findUserByProviderSubject` (one joined statement) plus `hasProviderIdentity`; the binding cookie is cleared before the use case runs, so a 500 clears it too.
