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
