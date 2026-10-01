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

## Block 3 — Second step of sign-in

| Required test | File:line (`apps/api/test/`) | Failure in the red run |
|---|---|---|
| password sign-in with 2FA → challenge, then TOTP starts the session (AC-04) | `identity/second-factor-sign-in.test.ts:186` | `expected {user} to equal {status:'second_factor_required'}` |
| TOTP replay refused on the next challenge (NFR-03) | `:224` | same |
| Google sign-in with 2FA → second-factor screen (AC-06) | `:242` | `expected '.../es' to be '.../es/sign-in/second-factor'` |
| users without 2FA still sign in in one step | `:268` | `expected {user} to equal {status:'signed_in',user}` |
| recovery code once, refused twice (AC-04, AC-05) | `:291` | `expected {user} to equal {status:'second_factor_required'}` |
| 3 wrong codes + 2 wrong passwords → 429 (NFR-01) | `:312` | same |
| 5 wrong passwords do not block the second step (NFR-04) | `:341` | same |
| 6th in 15 min and 21st in 24 h → 429 (NFR-04) | `:359` | same |
| no cookie, expired, consumed → `SECOND_FACTOR_EXPIRED` | `:409` | `expected 404 to be 401` |
| attempt count persists across requests | `:446` | `expected {user} to equal {status:'second_factor_required'}` |
| reset meanwhile / 2FA disabled meanwhile → expired, code not spent | `:486`, `:519` | same |
| malformed codes → 400 (9 cases) | `:566` | same |
| 12 verifies vs a pool of 10 complete | `identity/second-factor-races.test.ts:60` | same |
| same code twice / TOTP + recovery concurrently → one session | `identity/second-factor-races.test.ts:97, 117` | same |
| perf: recovery-code verify p95 < 1000 ms | `perf/second-factor.perf.test.ts:38` | `expected {'404':50} to equal {'200':50}` |
| web: `second_factor_required` navigates to the second-factor screen | `apps/web/test/sign-in-container.test.tsx` | `router.replace` not called with `/es/sign-in/second-factor` |

27/27 API, 1/1 perf and 1/1 web red before. After: 795 passed, 2 skipped; `pnpm test:perf` 4/4,
verify p95 76 ms.

### Block 3 review round 2

| Item | Test | Failure in the red run |
|---|---|---|
| verify holding the challenge lock while a disable runs (lock order) | `identity/second-factor-races.test.ts:226` | `expected 500 to be 204` (PostgreSQL deadlock under the old order) |
| `via` in the verify log lines | `identity/second-factor-sign-in.test.ts:199, 259, 311, 478, 555` | log objects without `via` |
| `findUnused` ordered by `created_at, id` | `identity/two-factor-persistence.test.ts:234` | `expected ['c','b','d','a'] to deeply equal ['a','b','c','d']` |

Characterisation tests added green: cookie cleared on expired (`:437`, `:478`), no key → 503 with
units refunded (`:636`), unit-of-work fault refunds (`second-factor-races.test.ts:286`), real reset
flow (`:555`), recovery code absent from logs (`:311`). After: 800 passed, 2 skipped; verify p95 75 ms.

Block verifier: PASSED (0 FAIL, 5 WARN). Architecture auditor: PASSED (0 FAIL, 5 WARN); the lock
order fix above addresses its deadlock warning.

## Block 4 — Web: security settings and second-factor screen

| Required test | File:line | Failure in the red run |
|---|---|---|
| e2e: enable from settings, codes shown once, second browser signed out (AC-01, AC-02, AC-07) | `apps/web/e2e/two-factor.spec.ts:111` | `TypeError` reading `es.app.nav.security` (UI absent) |
| e2e: password sign-in with second factor; wrong code; recovery code once (AC-04, AC-05) | `two-factor.spec.ts:160` | same |
| e2e: Google sign-in through the second-factor screen (AC-06) | `two-factor.spec.ts:201` | same |
| e2e: disable with a recovery code; next sign-in one step (AC-03) | `two-factor.spec.ts:223` | same |
| e2e: expired challenge returns to sign-in with the message | `two-factor.spec.ts:248` | `TypeError` reading `es.auth.secondFactor.code` |
| API client methods, refresh flags, error mapping | `apps/web/test/api-client.test.ts:314, 331, 392, 412, 425` | `client.<method> is not a function` |
| security link in the shell | `apps/web/test/auth-components.test.tsx:93` | `Cannot read properties of undefined (reading 'security')` |
| `second_factor_expired` message on sign-in | `apps/web/test/sign-in-container.test.tsx:135` | missing catalog key |
| new routes render | `apps/web/test/routes.test.tsx:44, 70` | `Failed to resolve import` |
| settings container (setup rejects non-numeric code, etc.) | `apps/web/test/security-settings-container.test.tsx:36–254` | `Failed to resolve import` |
| second-factor container (`SECOND_FACTOR_EXPIRED` → sign-in) | `apps/web/test/second-factor-container.test.tsx:29–103` | `Failed to resolve import` |
| components: recovery codes copy and download, forms | `apps/web/test/two-factor-components.test.tsx:30–287` | `Failed to resolve import` |
| every new screen in es and en with no missing keys | `apps/web/test/two-factor-i18n.test.tsx:126` | `Cannot find module` |

72/72 red before (component suites red as missing modules; every assertion then confirmed against
the implementation; the i18n test was shown to catch a removed key). After: 876 unit tests, 44 e2e,
coverage 96.34% lines, 92.75% branches, 92.83% functions.

### Block 4 review round 2

| Item | Test (`apps/web/test/`) | Failure in the red run |
|---|---|---|
| failed QR render resets and shows the error | `security-settings-container.test.tsx:271` | message not found; unhandled `Error: cannot render` |
| offline enable keeps the setup | `security-settings-container.test.tsx:287` | secret text not found (setup discarded) |
| rate-limited / offline disable keeps the form | `security-settings-container.test.tsx:310` | disable heading not found |
| focus moves to the new view's heading | `security-settings-container.test.tsx:350` | `expected <body> to be <h2 data-slot="card-title">` |
| `aria-current="page"` on the current nav link | `auth-components.test.tsx:116`, `authenticated-shell-container.test.tsx:130` | `expected null to be 'page'` |

Characterisation tests added green: `second-factor-container.test.tsx:103` (503), `:115` (offline),
`security-settings-container.test.tsx:333` (401 after refresh). E2E now asserts the enabled and
disabled notice emails by subject. After: 886 passed, 2 skipped; 44 e2e; coverage 96.45% lines,
92.89% branches, 92.85% functions.

Block verifier: PASSED (0 FAIL, 4 WARN). Architecture auditor: PASSED (0 FAIL, 7 WARN).
