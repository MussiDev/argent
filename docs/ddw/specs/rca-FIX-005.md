# RCA FIX-005: Cap the worker and web containers on Railway

| Field | Value |
|-------|-------|
| Ticket | FIX-005 |
| Tracker | none |
| Date | 2026-10-01 |
| Origin | Railway metrics review, 24 h after FEAT-001 |
| Related PRD | `docs/ddw/prd/prd-FEAT-001.md` (Railway Infrastructure as Code); no gap |
| PRD loops | 1 |
| Loops since last human decision | 1 |

## Context and Problem

`railway metrics --since 1d` (2026-10-01) shows the four Pesly services idle (CPU under 0.01 vCPU)
and well inside their V8 heap caps, but only `argent-api` has a container limit (2 vCPU, 2 GB).
`argent-worker` and `argent-web` report a limit of 24 vCPU and 24 GB: the plan maximum.

| Service | Memory now | Average, last 6 h | 24 h peak | V8 heap cap | Container limit |
|---|---|---|---|---|---|
| argent-worker | 46 MB | 107 MB | 569 MB | 192 MB | 24 GB |
| argent-web | 158 MB | 104 MB | 189 MB | 320 MB | 24 GB |

The 24 h peaks fall on deploys (2026-09-30 22:16–23:56, 2026-10-01 01:56 and 21:20), when Railway
runs the old and new containers together and the metric adds both.

### Root cause — the container limit was only carried over for the API

- **Component:** `.railway/railway.ts`.
- **Chain of events:**
  1. FIX-002 capped each process's V8 heap in its start command; it set no container limit.
  2. A container limit of 2 vCPU / 2 GB existed on `argent-api` only, set by hand in the UI.
  3. FEAT-001 declared the definition to match production, so it kept that limit on the API and
     none on the worker and web.
- **Technical root cause:** the heap cap bounds only the V8 heap. Native memory (buffers, the
  Next.js image optimizer, native modules), extra worker threads, and CPU have no bound on the
  worker and web, so a leak outside the heap or a CPU loop can grow up to the plan maximum before
  anything stops it.
- **Impact:** usage is billed by consumption, so an unbounded runaway on either service raises the
  bill and the quota with no ceiling; the goal of the Railway setup (avoid RAM and CPU overuse) is
  not enforced for two of the three application services.

## Goals

- Every application service has a container limit that bounds a runaway well below the plan
  maximum.
- Normal operation and deploys keep running without hitting the limit.

## Functional Requirements

- FR-01: The definition must cap `argent-worker` at 1 vCPU and 512 MB of memory.
- FR-02: The definition must cap `argent-web` at 1 vCPU and 1 GB of memory (1 GB rather than
  512 MB: the container needs room for its 320 MB V8 heap plus the memory Node uses outside it).
- FR-03: The definition must keep `argent-api` at 2 vCPU and 2 GB, and must not add a limit to
  `argent-postgres`.

## Non-Functional Requirements

- NFR-01: Each container memory limit is at least 2 times the service's V8 heap cap (192 MiB
  worker, 320 MiB web) and at least 3 times its 6-hour average memory: 512,000,000 bytes for the
  worker (2 × 192 MiB = 402,653,184; 3 × 107 MB = 321 MB) and 1,000,000,000 bytes for the web
  (2 × 320 MiB = 671,088,640; 3 × 104 MB = 312 MB).
- NFR-02: The plan against production lists only the two new limits: 0 creations, 0 deletions,
  0 other changes.
- NFR-03: Coverage stays at or above 80% lines, 80% branches and 80% functions over
  `apps/api/src`, `apps/web/src` and `packages/shared/src`.

## Acceptance Criteria

- AC-01 (FR-01, FR-02): WHEN the definition is checked by the test suite, THE test SHALL find a
  container limit of 1 vCPU and 512,000,000 bytes on `argent-worker`, and 1 vCPU and
  1,000,000,000 bytes on `argent-web`.
- AC-02 (FR-03): WHEN the definition is checked by the test suite, THE test SHALL find 2 vCPU and
  2,000,000,000 bytes on `argent-api` and no limit on `argent-postgres`.
- AC-03 (FR-01, FR-02): IF a service's container memory limit is below 2 times its V8 heap cap,
  THEN THE test suite SHALL fail naming that service.
- AC-04 (FR-01, FR-02): WHEN the plan runs against production, THE plan SHALL list only the
  container limits of `argent-worker` and `argent-web`.
- AC-05 (FR-01, FR-02): WHEN the limits are applied, THE worker and web SHALL be Online and
  `https://pesly.com.ar` SHALL answer.

## Out of Scope

- A limit on `argent-postgres` (a database needs its own sizing; FEAT-001 left its settings out).
- Replica counts and regions.

## Risks and Mitigations

- **A limit too low kills the service (out of memory):** Mitigation: NFR-01 margins, AC-03 test,
  and AC-05 after the apply; rollback is reverting the limit and applying again.
- **The apply redeploys the two services:** Mitigation: applied only with the user's approval,
  after reading the plan (NFR-02).

## Dependencies

- `.railway/railway.ts` and `apps/api/test/deploy/railway-iac.test.ts` (FEAT-001).
- `pnpm railway:plan` / `pnpm railway:apply` (`scripts/railway-config.mjs`).
