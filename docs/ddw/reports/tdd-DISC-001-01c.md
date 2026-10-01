# TDD evidence DISC-001-01c

Red-phase evidence per block, as reported by the implementer and checked by the block verifier.
Each required test was written first, seen failing for the reason below, then made to pass.

## Block 1 — TOTP engine, secret encryption and persistence

| Required test | File:line (`apps/api/test/`) | Failure in the red run |
|---|---|---|
| RFC 6238 SHA-1 vectors (6 cases) | `identity/totp.test.ts:21` | `expected '' to be '287082'` (and the other five vectors) |
| window: ±1 step accepted, ±2 rejected | `identity/totp.test.ts:29` | `expected null to be 37037036` |
| `otpauthUri` with issuer Pesly and a percent-encoded `+` | `identity/totp.test.ts:73` | `expected '' to be 'otpauth://totp/Pesly:ana%2Bargent%40e…'` |
| `seal`/`open` round-trip | `identity/secret-box.test.ts:30` | `expected 'GEZD…' not to contain 'GEZD…'` |
| tampered IV, ciphertext or tag; other key; other user id | `identity/secret-box.test.ts:57, 63, 69` | `expected [Function] to throw an error` |
| production env without the key; key not 32 bytes | `foundation/env.test.ts:187, 201` | `expected [Function] to throw an error` |
| 10 distinct codes in the documented format | `identity/recovery-code.test.ts:14` | `expected +0 to be 10` |
| normalization (spaces, dashes, lower case, I/L/O) | `identity/recovery-code.test.ts:49` | `expected null to be 'ABCDE12345'` |
| `advanceLastUsedStep` once, same, earlier | `identity/two-factor-persistence.test.ts:71` | `Error: not implemented` (stub) |
| `savePending` / `activate` refusals | `identity/two-factor-persistence.test.ts:118` | `Error: not implemented` |
| `replaceAll` stores only hashes; `markUsed` once | `identity/two-factor-persistence.test.ts:161` | `Error: not implemented` |
| `bumpCredentialsVersion` atomic and returned | `identity/two-factor-persistence.test.ts:234` | `TypeError: users.bumpCredentialsVersion is not a function` |
| challenge live, consumed once, expired | `identity/two-factor-persistence.test.ts:256` | `Error: not implemented` |
| purge deletes expired challenges | `identity/email-worker.test.ts:249` | `Error: not implemented` |
| a failing earlier purge does not skip the rest | `identity/email-worker.test.ts:284` | `expected [] to deeply equal [ '2026-09-30T12:00:00.000Z' ]` |
| worker delivers the notices without a token | `identity/email-worker.test.ts:316` | kind check violation on insert |
| notice dropped when the user was deleted | `identity/email-worker.test.ts:371` | kind check violation on insert |
| `0005` applies on `0004`; its rollback restores `0004` | `identity/migration.test.ts:528, 601` | `ENOENT … rollback\0005_two_factor.down.sql` |

Red run: 54/54 new unit tests and 32/32 new or changed database tests failing (12 sad-path cases
first passed against null stubs and were given positive controls, then re-run red). After: 741
passed, 2 skipped (FIX-002 `runIf`). Wiring assertions in `identity-infrastructure.test.ts` were
written after the wiring and are not TDD evidence.

Block verifier: PASSED (0 FAIL, 4 WARN; coverage 95.82% lines, 92.2% branches, 92.26% functions).
Architecture auditor: PASSED (0 FAIL, 6 WARN).

## Block 2 — Enrollment, disabling and notices

All 20 tests live in `apps/api/test/identity/two-factor-enrollment.test.ts` and were red against
stub use cases and an empty router (mostly `expected 404 to be 200`, `404 to be 409` or `404 to be
401`):

| Required test | Line |
|---|---|
| setup URI with `no-store`; enable activates (AC-01) | `:287` |
| 10 codes once, status count only, hashes only (AC-02, NFR-02) | `:320` |
| enable ends other sessions, new cookies, notice queued (AC-07) | `:358` |
| password sign-in and Google callback racing enable get dead sessions (AC-07) | `:380`, `:424` |
| failed re-issue still answers 200 with 10 codes | `:509` |
| setup between verify and activate → 409, 2FA off | `:542` |
| enable with wrong, replayed or no setup refused | `:575` |
| setup/enable when enabled → 409; disable when not enabled → 409 | `:605` |
| disable with TOTP: off, codes deleted, sessions ended, notice (AC-03, AC-07) | `:636` |
| disable with a recovery code (AC-03) | `:667` |
| disable with wrong, replayed or used code refused | `:679` |
| 6th within 15 min and 21st within 24 h → 429, sign-in second-factor units untouched, NFR-01 counted (NFR-04) | `:708` |
| failed NFR-01 record keeps the 400, failed refund keeps the 429, both reported | `:757` |
| unopenable sealed secret → 500 | `:793` |
| malformed code → 400 | `:808` |
| 401 without a session, 403 unverified (all routes) | `:838` |
| no key → 503 | `:860` |
| notices in es/en with no link, token or code | `:889` |
| no secrets in logs; redaction | `:935` |

`:679`, `:860` and `:889` were adjusted after the red run (an extra assertion, a test clock bug,
real subjects); all three were red before the implementation existed. After: 761 passed, 2 skipped.

### Block 2 review round 2

| Item | Test (`two-factor-enrollment.test.ts`) | Failure in the red run |
|---|---|---|
| a transaction fault refunds both disable units | `:920` | `expected 2 to be +0` |
| 2FA already removed inside the transaction → 409, no second bump or notice | `:939` | `expected 204 to be 409` |
| check fails because 2FA was removed meanwhile → 409, not counted | `:964` | `expected 400 to be 409` |
| two concurrent disables → one 204, one 409, one notice | `:981` | `expected [ 204, 400 ] to deeply equal [ 204, 409 ]` |
| recovery codes hashed one at a time | `:649` | `expected 10 to be 1` |
| a code that does not normalize → 500, 2FA off | `:682` | `expected 200 to be 500` |

Characterisation tests added green (no behaviour change): `:706`, `:720`, `:1027`, and unit/log
assertions at `:1054`, `:1123`, `:1199`. After: 770 passed, 2 skipped.

Block verifier: PASSED (0 FAIL, 7 WARN). Architecture auditor: PASSED (0 FAIL, 7 WARN); the
fixes above address the disable fault path, sequential hashing and the policy import cycle.
