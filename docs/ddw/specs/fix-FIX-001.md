# Fix-plan FIX-001: Fix review edge cases in session refresh and sign-in refund

| Field | Value |
|-------|-------|
| Ticket | FIX-001 |
| Tier | FIX |
| RCA | docs/ddw/specs/rca-FIX-001.md |
| Date | 2026-09-28 |
| Spec loops | 1 |
| Loops since last human decision | 1 |

## Problem

1. A refresh that races a sign-out, sign-out-all or password reset loses its rotation claim and is
   answered as token reuse: the family is revoked and the route logs
   `refresh token reused; session family revoked` at warn level, although no token was reused.
2. A rate-limited sign-in whose refund fails answers 500 `INTERNAL` instead of 429 `RATE_LIMITED`.

## Root cause

1. `RefreshSession` reads every `markReplaced(...) === false` as "a concurrent refresh rotated this
   token". `false` only means the session was already revoked; `replaced_by` is what tells a
   rotation from a sign-out or reset, and the lost-claim branch never looks at it.
2. `SignIn` awaits the refund on the rate-limited path without the try/catch the success path uses,
   so a rejected `release` escapes `execute`.

Full chain of events in `docs/ddw/specs/rca-FIX-001.md`.

## Coverage: RCA → steps

| Requirement | Covered by |
|---|---|
| FR-01 (AC-01, AC-02, AC-03) | Steps 1–3, 6–7 |
| FR-02 (AC-04, AC-05) | Steps 4–5, 8 |
| NFR-01 | No route, schema, migration or port signature changes (steps touch bodies and comments only) |
| NFR-02 | New unit and integration tests below; `pnpm test:coverage` thresholds unchanged |

## Solution — steps

1. `apps/api/src/identity/application/refresh-session.ts:79-83` — in the `RotationAlreadyClaimed`
   catch, re-read the session with `this.deps.sessions.findById(current.id)` (outside the rolled
   back transaction, so it sees committed state). If the row exists and `replacedBy !== null`,
   return `this.reuse(current.userId, current.familyId, now)`; otherwise return
   `{ outcome: 'rejected' }`. Update the comment at line 81 accordingly.
2. `apps/api/src/identity/application/refresh-session.ts:19-23` — extend the `RefreshSessionResult`
   JSDoc: a refresh that loses its claim to a sign-out, sign-out-all or reset is `rejected`.
3. `apps/api/src/identity/application/ports/session-repository.ts:29-33` — correct the
   `markReplaced` JSDoc: `false` means the session was already revoked, either rotated by a
   concurrent request (`replaced_by` set, reuse) or revoked without a successor (sign-out or reset).
4. `apps/api/src/identity/application/sign-in.ts:91-95` — wrap `await this.refund(reservations)` in
   try/catch calling `this.deps.reportRefundFailure(error)`, then throw `RateLimited` unchanged.
5. `apps/api/src/identity/application/sign-in.ts:47-51` — extend the `reportRefundFailure` JSDoc to
   cover the rate-limited path (the refusal still answers 429).
6. `apps/api/test/identity/refresh-session.test.ts:39-129` — replace the fake's
   `options.claim: boolean` with `options.claim: 'won' | 'rotated' | 'revoked' | 'deleted'`. On a
   lost claim the fake's transactional `markReplaced` first applies the concurrent writer's effect to
   the committed row (`rotated`: set `revokedAt` and `replacedBy`; `revoked`: set `revokedAt` only;
   `deleted`: remove the row) and then resolves `false`. Fix the comment at line 87. Rewrite the
   existing lost-claim test (line 132) as the `rotated` case.
7. `apps/api/test/identity/reset-session-races.test.ts` — add an integration test with real
   repositories: a sign-out committed between the refresh's read and its claim (latch held before
   `unitOfWork.run` starts, reusing `latch()` and `untilSomeoneWaitsForALock`).
8. `apps/api/test/identity/sign-in-use-case.test.ts` — add unit tests for the rate-limited path
   with an `attemptLimiter` override whose `record` returns `allowed: false`.

`apps/api/src/identity/index.ts:208-213` (`reportRefundFailure` wiring, warn level) is not changed:
its message fits both paths (RCA, user decision 2026-09-28).

## Dependencies between steps

Steps 1–3 and 6–7 form the refresh fix; steps 4–5 and 8 form the sign-in fix. The two groups are
independent. Within each group the tests (6–8) are written first and seen to fail, then the code
steps make them pass.

## Error handling

- The rotation claim is lost and the re-read finds `replaced_by` set — `reused`: family revoked,
  401 `UNAUTHENTICATED`, reuse warning logged by the route (unchanged behaviour).
- The rotation claim is lost and the re-read finds the session revoked without a successor —
  `rejected`: 401 `UNAUTHENTICATED`, cookies cleared, no family revocation and no reuse warning.
- The rotation claim is lost and the re-read finds no row — `rejected`: 401 `UNAUTHENTICATED`.
- The re-read itself fails (database error) — the error propagates to the error middleware, 500
  `INTERNAL`; nothing is revoked (fail closed for the request, no false theft signal).
- The refund fails on a rate-limited sign-in — `reportRefundFailure(error)` logs at warn and the
  use case throws `RateLimited`: 429 `RATE_LIMITED`; the reserved units stay counted (fail safe).

## Tests

- [ ] **Regression test** — lost claim after a sign-out answers 401 `rejected`, no family revoked
      (fails BEFORE the fix, which answers `reused`; passes AFTER). Validates AC-02.
- [ ] Lost claim to a concurrent rotation answers 401 `reused` and revokes the family. Validates
      AC-01.
- [ ] Lost claim whose row is missing on re-read answers 401 `rejected`. Validates AC-03.
- [ ] Re-read error after a lost claim: `findById` rejects, the error propagates (500) and no family
      is revoked.
- [ ] Integration: a sign-out committed between the refresh's read and its claim answers 401, logs
      no reuse warning and revokes nothing else. Validates AC-02 against PostgreSQL.
- [ ] Integration (existing, kept as the AC-01 regression): `sessions.test.ts:209`, two concurrent
      refreshes of one token → one 200, one 401, family revoked.
- [ ] **Regression test** — rate-limited sign-in whose refund fails answers 429 `RateLimited` and
      calls `reportRefundFailure` with the error (fails BEFORE the fix, which rejects with the
      release error; passes AFTER). Validates AC-04.
- [ ] Rate-limited sign-in whose refund succeeds answers 429 `RateLimited` and does not call
      `reportRefundFailure`. Validates AC-05.

## Regression risk

Low. Both changes are confined to failure branches of two use cases; the success paths, the
routes, the schema and every port signature are unchanged. The one behaviour that must not regress,
real reuse still revoking the family, is covered by the existing real-database concurrency test.

## Rollback plan *(mandatory)*

- Steps: trivial: revert the fix commit on `fix/FIX-001-auth-review-edge-cases` (or on the PR #2
  branch once merged into it). No data or schema to undo.
- Indicators: `refresh token reused` warnings disappear while two concurrent refreshes of one token
  both return 200, or rate-limited sign-ins start returning anything other than 429.
