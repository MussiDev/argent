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
