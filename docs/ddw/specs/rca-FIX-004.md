# RCA FIX-004: Concurrent Google callbacks fail intermittently with google_failed

| Field | Value |
|-------|-------|
| Ticket | FIX-004 |
| Tracker | none |
| Date | 2026-10-01 |
| Origin | CI of PR #7 (FEAT-001): `test/identity/google-sign-in-races.test.ts` failed 2 of 3 runs |
| Related PRD | `docs/ddw/prd/prd-DISC-001-01b.md` (Google sign-in, threat R-35); no gap |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem

The test "end with exactly one user and one identity for the same new Google subject" sends four
concurrent Google callbacks for the same new Google account. In CI one of them intermittently ends
in `https://links.argent.test/en/sign-in?error=google_failed` instead of signing in; it passed 15 of
15 runs locally and on `main`'s CI, and failed 2 of 3 runs on the FEAT-001 branch, which does not
touch the identity module. The failure is a real defect of the sign-in flow, not of the test: in
production a double click on "Continue with Google", or two tabs finishing the flow together, can
show the same error to a user whose sign-in actually succeeded in the other request.

### Root cause — a check-then-act gap across statements

- **Component:** `apps/api/src/identity/application/complete-google-sign-in.ts`, `resolveAccount`.
- **Chain of events** (transactions run at PostgreSQL's default READ COMMITTED, so every statement
  sees what was committed before it started):
  1. Callback B runs `identities.findUserByProviderSubject('google', subject)` (line 151) and finds
     nothing: callback A has not committed yet.
  2. Callback A commits the new user and its Google identity.
  3. B runs `users.findByEmail(email)` (line 155) and now finds A's user.
  4. B runs `identities.hasProviderIdentity(existing.id, 'google')` (line 160): true, because of A's
     identity — the same Google subject B is signing in with.
  5. B returns `refused: another_identity_linked`. A refusal is a normal result, not a conflict
     error, so `resolveAccountWithRetry` does not retry it, and the route redirects to
     `google_failed`.
- **Technical root cause:** the refusal "this user already has a different Google account" is
  decided from two reads taken at different moments, and it never checks whether the identity it
  found is the one being signed in with. The retry added for threat R-35 only covers unique
  violations, not this interleaving.
- **Evidence:** a test that commits a competing callback right after B's identity lookup reproduces
  it every time: the competitor ends `signed_in` and B ends
  `{ outcome: 'failed', reason: 'another_identity_linked' }`.
- **Impact:** a user can see "Google sign-in failed" while the same sign-in succeeded in a parallel
  request; CI fails intermittently on unrelated changes.

## Goals

- Concurrent callbacks for the same Google account all sign in to the one account they create.
- A user who already has a different Google account linked is still refused.

## Functional Requirements

- FR-01: When the user found by email already has a Google identity whose subject is the one being
  signed in with, the callback must sign in to that user instead of refusing it.
- FR-02: When the user found by email has a Google identity with a different subject, the callback
  must keep refusing with `another_identity_linked`.

## Non-Functional Requirements

- NFR-01: The fix changes 0 HTTP contracts, 0 database columns and 0 migrations.
- NFR-02: Coverage stays at or above 80% lines, 80% branches and 80% functions over
  `apps/api/src`, `apps/web/src` and `packages/shared/src`.
- NFR-03: The four-callback race test passes 20 of 20 consecutive local runs after the fix.

## Acceptance Criteria

- AC-01 (FR-01): WHEN another callback commits the same Google account between the identity lookup
  and the email lookup, THE callback SHALL sign in to that account with `via: existing_identity`.
- AC-02 (FR-01): WHEN four callbacks for the same new Google account run concurrently, THE system
  SHALL end with one user and one identity, and every callback SHALL redirect to the signed-in page.
- AC-03 (FR-02): IF the user found by email has a Google identity with a different subject, THEN THE
  callback SHALL refuse with `another_identity_linked` and create nothing.

## Out of Scope

- Changing the transaction isolation level of the unit of work.
- The per-worktree test databases (a separate ticket).

## Risks and Mitigations

- **The fix lets a second Google account into an existing user:** Mitigation: FR-02 and AC-03; the
  sign-in only proceeds when the identity found is the same subject.
- **The race window moves elsewhere:** Mitigation: AC-02 keeps the concurrent test, and NFR-03
  requires repeated runs.

## Dependencies

- `apps/api/src/identity/application/ports/user-identity-repository.ts`
  (`findUserByProviderSubject`, `hasProviderIdentity`).
- `apps/api/test/identity/google-sign-in-races.test.ts`.
