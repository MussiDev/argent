# Fix-plan FIX-005: Cap the worker and web containers on Railway

| Field | Value |
|-------|-------|
| Ticket | FIX-005 |
| Tier | FIX |
| RCA | docs/ddw/specs/rca-FIX-005.md |
| Date | 2026-10-01 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Problem
`argent-worker` and `argent-web` run with no container limit, so Railway gives them the plan
maximum (24 vCPU, 24 GB); a memory leak outside the V8 heap or a CPU loop has no ceiling on the
bill.

## Root cause
FIX-002 capped only the V8 heap in the start commands; the only container limit, on `argent-api`,
was set by hand and carried into `.railway/railway.ts` by FEAT-001, which added none for the worker
and web (RCA FIX-005).

## Block 1 — Container limits for the worker and web

## Solution — steps
1. `apps/api/test/deploy/railway-iac.test.ts` — replace the API-only limit test with a list of
   expected limits (`argent-api` 2 vCPU / 2,000,000,000 bytes, `argent-worker` 1 vCPU /
   512,000,000 bytes, `argent-web` 1 vCPU / 1,000,000,000 bytes) and assert `argent-postgres`
   declares none. Written first; it fails before step 3.
2. `apps/api/test/deploy/railway-iac.test.ts` — add a pure helper,
   `containerMemoryIssues(services, heapCapsMb)`, that names every service whose container memory
   limit is missing or below 2 times its V8 heap cap in MiB; assert it is empty for the definition
   and exercise it on hand-built nodes (a limit below twice the heap, and no limit at all).
3. `.railway/railway.ts` — add `limitOverride: { containers: { cpu: 1, memoryBytes: 512_000_000 } }`
   to `argent-worker` and `{ cpu: 1, memoryBytes: 1_000_000_000 }` to `argent-web`, next to their
   restart setting.
4. Production (manual, with the user): `pnpm railway:plan` must list only the two new limits; the
   user approves; `pnpm railway:apply`; a second plan is up to date; the services are Online and
   `https://pesly.com.ar` answers.
5. `CHANGELOG.md` — entry under "Fixed" (at CLOSEOUT).

## Dependencies between steps
Steps 1 and 2 come first and must fail before step 3 (TDD). Step 4 runs after step 3 is committed
and before the pull request is merged. Step 5 runs at CLOSEOUT.

## Error handling
- A container memory limit below twice the V8 heap cap, or a missing limit — the test fails naming
  the service and the expected minimum.
- The plan lists anything besides the two new limits (a creation, a deletion, another change) —
  stop; nothing is applied; the definition is corrected and the plan is run again.
- A service fails to start or keeps restarting after the apply (out of memory) — roll back: revert
  the limit in the definition and apply again, with the user's approval.

## Tests
- [ ] **Regression test** — the definition caps `argent-worker` at 1 vCPU / 512,000,000 bytes and
      `argent-web` at 1 vCPU / 1,000,000,000 bytes, keeps the API at 2 vCPU / 2,000,000,000 bytes
      and declares no limit on `argent-postgres` (AC-01, AC-02): fails BEFORE the fix (no limit on
      the worker and web), passes AFTER.
- [ ] Sad path, container memory limit below twice the V8 heap cap, or a missing limit:
      `containerMemoryIssues` names the service and the expected minimum (AC-03).
- [ ] Sad path, the plan lists anything besides the two new limits (manual, recorded in the test
      report): nothing is applied; the plan run lists only the two limits (AC-04).
- [ ] Sad path, a service fails to start or keeps restarting after the apply (manual, recorded in
      the test report): roll back; after the apply the worker and web are Online and
      `https://pesly.com.ar` answers (AC-05).

## Regression risk
Low — the limits are 2.7 times (worker) and 3 times (web) the V8 heap caps, and 4 to 10 times the
measured memory; a deploy runs its new container under its own limit. The apply redeploys the two
services once.

## Rollback plan *(mandatory)*
- Steps: revert the commit, then `pnpm railway:plan` and, with the user's approval,
  `pnpm railway:apply` to remove the limits.
- Indicators: the worker or web restarting with out-of-memory exits, or memory reaching 90% of the
  new limit in `railway metrics`.
