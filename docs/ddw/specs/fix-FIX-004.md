# Fix-plan FIX-004: Concurrent Google callbacks fail intermittently with google_failed

| Field | Value |
|-------|-------|
| Ticket | FIX-004 |
| Tier | FIX |
| RCA | docs/ddw/specs/rca-FIX-004.md |
| Date | 2026-10-01 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Problem
One of several concurrent Google callbacks for the same new Google account can end in
`/sign-in?error=google_failed` although the same sign-in succeeded in a parallel request; the
four-callback race test fails intermittently in CI.

## Root cause
`resolveAccount` (`apps/api/src/identity/application/complete-google-sign-in.ts:151-162`) decides
"this user already has a different Google account" from two reads taken at different moments under
READ COMMITTED: the identity lookup by subject misses the competitor's uncommitted identity, the
email lookup then sees the competitor's committed user, and `hasProviderIdentity` sees that same
identity. The refusal `another_identity_linked` is not a conflict error, so it is never retried
(RCA FIX-004).

## Block 1 — Sign in when the identity found is the same Google account

## Solution — steps
1. `apps/api/src/identity/application/complete-google-sign-in.ts:160` — when
   `identities.hasProviderIdentity(existing.id, 'google')` is true, read
   `identities.findUserByProviderSubject('google', claims.subject)` again in the same transaction.
   If it returns the user with `existing.id`, return
   `{ outcome: 'resolved', via: 'existing_identity', user }` with the user it returned (read together
   with its link, as the first lookup does for R-37). Otherwise keep refusing with
   `another_identity_linked`.
2. `apps/api/test/identity/google-sign-in-races.test.ts` — add the regression test: a unit of work
   whose identity lookup lets a competing callback complete and commit right after the lookup
   returns, then asserts that the callback signs in with `via: existing_identity` to the
   competitor's user.
3. `apps/api/test/identity/google-sign-in-races.test.ts` — add the sad path: a user found by email
   whose Google identity has a different subject is still refused with `another_identity_linked`,
   and no user or identity is created.
4. `CHANGELOG.md` — entry under "Fixed" (at CLOSEOUT).

## Dependencies between steps
Step 2 is written first and must fail before step 1 (TDD). Step 3 is independent of the others.
Step 4 runs at CLOSEOUT.

## Error handling
- The identity found has a different subject — the callback returns
  `{ outcome: 'failed', reason: 'another_identity_linked' }` as before, and the route redirects to
  `google_failed`.
- A unique violation from a competing insert — unchanged: `resolveAccountWithRetry` retries once in
  a new transaction, then returns `conflict`.
- An unexpected database fault — unchanged: it propagates to the error middleware.

## Tests
- [ ] **Regression test** — a competing callback committing between the identity lookup and the
      email lookup no longer refuses the callback: it signs in with `via: existing_identity` to the
      competitor's user (AC-01). Fails BEFORE the fix with
      `{ outcome: 'failed', reason: 'another_identity_linked' }`, passes AFTER.
- [ ] Sad path, identity found has a different subject: a user found by email with a Google
      identity of a different subject is still refused with `another_identity_linked`, and nothing
      is created (AC-03).
- [ ] Sad path, unique violation from a competing insert: the existing test "fails after a second
      conflict instead of retrying again" still passes — retried once, then `conflict`.
- [ ] Sad path, unexpected database fault: the existing test "lets an unexpected database fault
      through" still passes — it propagates to the error middleware.
- [ ] The existing four-callback race test passes 20 of 20 consecutive local runs (AC-02, NFR-03).

## Regression risk
Low — the change only adds a read in the branch that used to refuse; a refusal for a different
Google account is kept and tested (AC-03). The happy paths (new user, existing identity, link to a
verified account, supersede an unverified one) do not reach that branch.

## Rollback plan *(mandatory)*
- Steps: trivial: revert the commit.
- Indicators: a user with a second Google account gets signed in instead of refused, or the Google
  sign-in tests fail after merge.
