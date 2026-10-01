# Threat model FIX-005: Cap the worker and web containers on Railway

| Field | Value |
|-------|-------|
| Ticket | FIX-005 |
| Spec | docs/ddw/specs/fix-FIX-005.md |
| Tier | FIX |
| Date | 2026-10-01 |

## Components
| Component | Source in the spec |
|---|---|
| `.railway/railway.ts` (`limitOverride` on `argent-worker` and `argent-web`) | Block 1, step 3 |
| `apps/api/test/deploy/railway-iac.test.ts` (`containerMemoryIssues`) | Block 1, steps 1 and 2 |

## Trust boundaries
- Developer machine → Railway API: `pnpm railway:plan|apply` carry the user's Railway session and
  the new limits; apply changes production and redeploys the two services.
- Internet → `argent-web` (`pesly.com.ar`): public traffic now runs inside a 1 vCPU / 1 GB
  container.

## STRIDE analysis
### `.railway/railway.ts` (`limitOverride` on `argent-worker` and `argent-web`)
- **Spoofing:** the change carries no credential; apply authenticates with the user's own session.
- **Tampering:** a limit set too low through a later edit is caught by `containerMemoryIssues` in
  CI before it can be applied.
- **Repudiation:** the change is a reviewed commit; Railway's activity log records the apply.
- **Information Disclosure:** no variable or secret changes.
- **Denial of Service:** the limits bound a runaway's cost, and also cap how much load the web can
  absorb: a traffic spike or a leak now ends in an out-of-memory restart instead of unbounded
  growth (R-01).
- **Elevation of Privilege:** none; resource limits grant no access.

### `apps/api/test/deploy/railway-iac.test.ts` (`containerMemoryIssues`)
- **Spoofing:** offline evaluation, no identity.
- **Tampering:** the expected limits are written in the test, not imported from the definition.
- **Repudiation:** runs in CI on every pull request.
- **Information Disclosure:** reads only the definition's nodes.
- **Denial of Service:** pure in-process evaluation.
- **Elevation of Privilege:** no access to Railway.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Container limits (vCPU, bytes) | public | committed in `.railway/railway.ts` | TLS to the Railway API |
| Railway session token | credentials | the CLI's config in the user's home directory, outside the repository | TLS to the Railway API |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A limit too low makes the worker or web restart out of memory under normal load | D | L | M | limits are at least 2 times the V8 heap cap and 3 times the measured average (NFR-01); `containerMemoryIssues` enforces the floor; rollback plan in the fix-plan |
| R-02 | The apply touches other services or recreates one | D | L | H | the plan must list only the two limits before the user approves the apply (AC-04) |

## Supply chain
No dependency change.

## Availability
The web keeps one replica; the limits only apply to a runaway. The apply redeploys the worker and
web once, with Railway's usual overlap.
