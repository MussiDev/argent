# TDD evidence DISC-001-01b

Red-phase evidence per block, as reported by the implementer and checked by the block verifier.
Each required test was written first, seen failing for the reason below, then made to pass.

## Block 1 — Google identities, OAuth states and password-less accounts

| Required test | File:line (`apps/api/test/identity/`) | Failure in the red run |
|---|---|---|
| user created without a password and with `emailVerifiedAt` | `google-persistence.test.ts:71` | `23502` not-null violation on `password_hash` |
| `supersedeUnverified` clears the password, bumps the version, verifies the email | `google-persistence.test.ts:85` | `TypeError: users.supersedeUnverified is not a function` |
| `supersedeUnverified` on a verified user returns null and changes nothing | `google-persistence.test.ts:100` | same `TypeError` |
| `link` stores the flag; `findUserIdByProviderSubject` returns the user | `google-persistence.test.ts:111` | `Error: not implemented` (stub) |
| same subject twice / second Google identity for one user → `IdentityAlreadyLinked` | `google-persistence.test.ts:137` | `Error: not implemented` |
| `deleteNonAuthoritativeForUser` deletes only non-authoritative identities | `google-persistence.test.ts:168` | `Error: not implemented` |
| `consume` returns the state once; a second consume returns null | `google-persistence.test.ts:199` | `Error: not implemented` |
| `consume` with a wrong binding returns null | `google-persistence.test.ts:209` | `Error: not implemented` |
| `consume` of an expired row returns null | `google-persistence.test.ts:216` | `Error: not implemented` |
| password sign-in for a password-less user → 401 `INVALID_CREDENTIALS`, same body | `sign-in.test.ts:126` | `23502` when seeding the password-less user |
| retention purge deletes expired `oauth_states`, keeps live ones | `email-worker.test.ts:212` | `Error: not implemented` |
| migration `0004` applies on a database at `0003` | `migration.test.ts:391` | `ENOENT … 0004_google_identity.down.sql` |
| rollback fails with `23502` while a password-less user exists | `migration.test.ts:439` | `AssertionError: expected +0 to be 1` |
| rollback restores `0003` and removes `google_start_ip` rows | `migration.test.ts:451` | `ENOENT … 0004_google_identity.down.sql` |
| existing rollback chains start with `0004` | `migration.test.ts:190, 222, 304, 360` (`:96` is the apply-on-empty test, red on the new table list) | table list mismatch, `expected 4 to be 5`, `ENOENT` |
| new adapters wired in `IdentityInfrastructure` | `identity-infrastructure.test.ts` | `expected undefined to be an instance of DrizzleUserIdentityRepository` |

Red run: 20 failed, 18 passed across 4 files. After: 41/41 in the block's files; full suite 505/505.

Block verifier: PASSED (0 FAIL, 2 WARN). The password-less sign-in test failed only while seeding
(`password_hash` was `not null`); the spec states the block adds that test without new logic.
Architecture auditor: PASSED (0 FAIL, 5 WARN); the rollback header now says to stop the API and
worker first.

## Block 2 — Google OpenID Connect adapter

| Required test | File:line | Failure in the red run |
|---|---|---|
| valid code → subject, lower-cased email, `emailVerified`, `hostedDomain` | `apps/api/test/identity/google-oidc-identity-provider.test.ts:85, 97` | `Error: not implemented` (stub) |
| `isGoogleAuthoritative` | `apps/api/test/identity/google-authority.test.ts:5, 9, 14, 18, 25, 29` | `Error: not implemented` |
| ID token signed with another key (same `kid`) | `google-oidc-identity-provider.test.ts:108` | `Error: not implemented` |
| wrong audience, issuer, array `aud` with foreign `azp`, expired token | `google-oidc-identity-provider.test.ts:116, 124, 132, 161` (+ `143, 151, 169`) | `Error: not implemented` |
| nonce mismatch | `google-oidc-identity-provider.test.ts:179, 187` | `Error: not implemented` |
| wrong PKCE verifier (400) and token endpoint slower than 2 s | `google-oidc-identity-provider.test.ts:197, 217` | `Error: not implemented` |
| `authorizationUrl` parameters | `google-oidc-identity-provider.test.ts:332` | `Error: not implemented` |
| production env without client credentials or with a non-Google endpoint | `apps/api/test/foundation/env.test.ts:136, 147` | `expected [Function] to throw an error` |
| unconfigured provider fails every call | `google-oidc-identity-provider.test.ts:368` | asymmetric matcher mismatch |

Red run: 48/48 new tests failing. After: 48/48; full suite 553/553.

Block verifier: PASSED (0 FAIL, 4 WARN). Architecture auditor: PASSED (0 FAIL, 5 WARN). Follow-up
fixes (trimmed client credentials, shared issuer constant, algorithm/`kid`/`iat`/JWKS tests, stricter
fake `/authorize`) land in a separate commit.

### Block 2 review follow-ups

| Item | Test (file:line) | Failure in the red run |
|---|---|---|
| whitespace-only client credentials rejected; values trimmed | `apps/api/test/foundation/env.test.ts:146, 153, 159` | `expected [Function] to throw an error`; `expected ' local-client ' to be 'local-client'` |
| production-only secret rule isolated | `env.test.ts:141` | red by mutation (rule removed → wrong issue message) |
| token body limited to 16 KB | `apps/api/test/identity/google-oidc-identity-provider.test.ts:258, 279, 303` | `expected undefined to be 16384`; unbounded read of 134 MB; body read despite Content-Length |
| HS256 / `none`, unknown `kid`, future `iat` rejected | `google-oidc-identity-provider.test.ts:334, 347, 355` | `expected the exchange to fail` |
| JWKS slower than 2 s fails | `google-oidc-identity-provider.test.ts:371` | `expected undefined to be 2000` |
| fake `/authorize` rejects unregistered `redirect_uri` and scope without `openid` | `apps/api/test/identity/fake-google-oidc.test.ts:54, 58, 70, 88` | `expected 200 to be 400` |

21/25 red before (the rest: regression guards and pre-existing fixture paths); 25/25 after; full suite 581/581.

## Block 3 — Google sign-in use cases and routes

| Required test | File:line | Failure in the red run |
|---|---|---|
| start, callback outcomes AC-01..AC-09, sad paths, rate limit, query validation, no secrets in logs (25 tests) | `apps/api/test/identity/google-sign-in.test.ts:181–603` | 22× `expected 404 to be 302`, 2× `expected 404 to be 400`, 1× `toMatch() expects a string, got undefined` (no route yet) |
| concurrent callbacks, retry, second identity (4 tests) | `apps/api/test/identity/google-sign-in-races.test.ts:100–190` | `Cannot find module '…/complete-google-sign-in'` |
| password reset removes non-authoritative identities, keeps authoritative ones | `apps/api/test/identity/password-reset.test.ts:419` | `TypeError: Invalid URL` (start answered 404) |
| `ResponseFacade.redirect` answers 302 with `Location` | `apps/api/test/foundation/validate.test.ts:176` (+ facade keys `:86`) | `expected 500 to be 302`; facade keys mismatch |
| perf: callback p95 < 500 ms | `apps/api/test/perf/google-callback.perf.test.ts:94` | `expected { '404': 200 } to deeply equal { '302': 200 }` |
| `StartSession` extraction keeps sign-in and reset-race behaviour | `sign-in-use-case.test.ts`, `reset-session-races.test.ts` | `Cannot find module '…/start-session'` |

32/32 new tests red before; after: 612/612; `pnpm test:perf` 3/3, Google callback p95 191 ms.

### Block 3 review round 2 (architecture FAIL: identity and user read in two statements)

| Item | Test (file:line) | Failure in the red run |
|---|---|---|
| reset committing right after the identity lookup leaves no live session | `apps/api/test/identity/google-sign-in-races.test.ts:256` | `expected { …(2) } to be null` (a live session was issued) |
| callback fault answers 500 and clears the binding cookie | `apps/api/test/identity/google-sign-in.test.ts:493` | `expected undefined to be ''` |
| second Google identity refused with `another_identity_linked` | `google-sign-in.test.ts:490` | `expected [ 'conflict' ] to deeply equal [ 'another_identity_linked' ]` |
| supersede returns null (verified meanwhile) → link | `google-sign-in-races.test.ts:289` | green from the start (branch existed); red by mutation (link replaced by refusal) |

After: 615/615; `pnpm test:perf` 3/3, Google callback p95 191 ms.

## Block 4 — Web Google sign-in

| Required test | File:line | Failure in the red run |
|---|---|---|
| unit: start URL has the device time zone and the locale | `apps/web/test/google-start-url.test.ts:6, 26, 38` | `Cannot find module '../src/features/auth/google-start-url'` |
| component: button renders the localized label and links to the start URL | `apps/web/test/google-sign-in-button.test.tsx:10, 20` | `Failed to resolve import ".../google-sign-in-button"` |
| component: sign-in shows the Google error for `google_failed`, ignores unknown values | `apps/web/test/sign-in-container.test.tsx:107, 119, 132` | missing catalog key (`undefined was passed instead of a matcher`; `reading 'continue'`) |
| sign-in and register offer Google | `sign-in-container.test.tsx:93`, `register-container.test.tsx:85` | `Cannot read properties of undefined (reading 'continue')` |
| error message in both languages; divider only with a start URL | `apps/web/test/auth-error-messages.test.tsx:111, 131` | `expected '...' to include undefined` |
| Google link named by its label, mark hidden | `apps/web/test/auth-form-accessibility.test.tsx:106` | `expected undefined to be 'http://api.argent.test/auth/google/st…'` |
| `useApiOrigin` | `apps/web/test/api-client-provider.test.tsx:55, 65` | `TypeError: useApiOrigin is not a function` |
| e2e AC-01/AC-04, AC-02, cross-site `Lax`, AC-03, AC-05, AC-06, AC-07, AC-08, AC-09, English flow | `apps/web/e2e/google.spec.ts:87, 114, 130, 164, 178, 189, 214, 236, 253, 274` | redirected to `/es/sign-in?error=google_failed` (API had no Google configuration) |
| e2e: button on both screens in `/es` and `/en` | `google.spec.ts:292` | written after the UI (not red); the same behaviour was red first at unit level |

After: 639 unit tests, 39 e2e (25 + 14), coverage 95.65% lines / 92.23% branches / 92.29% functions.

Block verifier: PASSED (0 FAIL, 3 WARN). Architecture auditor: PASSED (0 FAIL, 3 WARN).
