# RCA FIX-001: Fix review edge cases in session refresh and sign-in refund

| Field | Value |
|-------|-------|
| Ticket | FIX-001 |
| Tracker | none |
| Date | 2026-09-28 |
| Origin | `/code-review` of PR #2 (DISC-001-01a) |
| Related PRD | `docs/ddw/prd/prd-DISC-001-01a.md` (no gap) |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem

A code review of PR #2 reported three low-severity edge cases in the identity module. Two are
defects and are fixed here. The third (email worker: a send accepted by the provider followed by a
failed commit leaves the user with a dead link and a second email) is the at-least-once delivery
recorded and accepted in `spec-DISC-001-01a.md` (Block 3 drift, 2026-09-26). By user decision
(2026-09-28) it stays out of this ticket.

### Root cause 1 — a lost rotation claim is always read as token reuse

- **Component:** `apps/api/src/identity/application/refresh-session.ts` (use case `RefreshSession`).
- **Chain of events:**
  1. `/auth/refresh` reads the session by refresh token hash; it is live (`revoked_at` null).
  2. Before the rotation transaction claims it, a concurrent `/auth/sign-out`, `/auth/sign-out-all`
     or password reset sets `revoked_at` on that session (without `replaced_by`).
  3. `markReplaced` (`UPDATE … WHERE id = ? AND revoked_at IS NULL`) matches no row and returns
     `false`.
  4. The use case treats every `false` as "a concurrent refresh rotated this token first", throws
     `RotationAlreadyClaimed`, and calls `reuse`: the whole family is revoked and the route logs
     `refresh token reused; session family revoked` at warn level.
- **Technical root cause:** the port contract of `markReplaced` says "false means the token was
  already used", but `false` only means "the session was already revoked". The use case cannot tell
  a rotation (`replaced_by` set) from a sign-out or reset (`replaced_by` null), which the pre-claim
  branch of the same use case already distinguishes.
- **Impact:** a false theft signal in the logs, and the other live sessions of the family (none in
  practice, since a family has one live session at a time) are revoked. The client gets 401 either
  way.

### Root cause 2 — a failed refund on the rate-limited path escapes as a 500

- **Component:** `apps/api/src/identity/application/sign-in.ts` (use case `SignIn`).
- **Chain of events:**
  1. A sign-in reserves one unit per key; at least one reservation exceeds its limit.
  2. The use case refunds both reservations before throwing `RateLimited`.
  3. If `attemptLimiter.release` fails (for example a transient database error), the rejection
     propagates out of `execute` instead of `RateLimited`.
  4. The error middleware maps the unknown error to 500 `INTERNAL`.
- **Technical root cause:** the refund on the rate-limited path is awaited without the try/catch
  that the success path uses (`reportRefundFailure`). The success path was hardened; the refusal
  path was not.
- **Impact:** a client that is rate-limited gets 500 `INTERNAL` instead of 429 `RATE_LIMITED`.
  The leaked units only make the limiter stricter (fail safe).

## Goals

- A refresh that loses its claim to a sign-out, sign-out-all or password reset answers 401 without
  a reuse signal and without revoking the family.
- A rate-limited sign-in always answers 429, whether or not its refund succeeds.

## Functional Requirements

- FR-01: The system must distinguish, after a lost rotation claim, a session replaced by a
  concurrent rotation (`replaced_by` set) from a session revoked without a successor, and treat only
  the first as refresh token reuse.
- FR-02: The system must report a failed refund on the rate-limited sign-in path through
  `reportRefundFailure` and still refuse the attempt as rate-limited.

## Non-Functional Requirements

- NFR-01: The fix changes 0 HTTP contracts, 0 database columns and 0 migrations.
- NFR-02: Coverage stays at or above 80% lines, 80% branches and 80% functions over
  `apps/api/src`, `apps/web/src` and `packages/shared/src`.

## Acceptance Criteria

- AC-01 (FR-01): WHEN a refresh loses its rotation claim because a concurrent refresh rotated the
  same session, THE system SHALL revoke the session family and answer `reused` (401).
- AC-02 (FR-01): IF a refresh loses its rotation claim because the session was revoked by sign-out,
  sign-out-all or password reset, THEN THE system SHALL answer `rejected` (401) and SHALL leave the
  other sessions of the family unrevoked.
- AC-03 (FR-01): IF the session row is no longer found when re-read after a lost claim, THEN THE
  system SHALL answer `rejected` (401).
- AC-04 (FR-02): IF the refund fails on a rate-limited sign-in, THEN THE system SHALL answer 429
  `RATE_LIMITED` and SHALL call `reportRefundFailure` with the error.
- AC-05 (FR-02): WHEN the refund succeeds on a rate-limited sign-in, THE system SHALL answer 429
  `RATE_LIMITED` without calling `reportRefundFailure`.

## Out of Scope

- The email worker at-least-once delivery (review finding 3); accepted in `spec-DISC-001-01a.md`.
- Any change to rate limit values or windows (NFR-03 of DISC-001-01a).

## Risks and Mitigations

- **Masking real reuse:** if the re-read wrongly reported `replaced_by` as null, a stolen token would
  stop revoking its family. Mitigation: AC-01 is tested against the real repository with two
  concurrent rotations, not only with a fake.
- **Silent refund failures:** reporting instead of throwing could hide a broken limiter store.
  Mitigation: the same `reportRefundFailure` hook as the success path, which logs at error level.

## Dependencies

- `SessionRepository.findById` (existing) for the re-read after a lost claim.
- `SignInDependencies.reportRefundFailure` (existing).
