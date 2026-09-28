# Verification DISC-001-01a

| Field | Value |
|---|---|
| Ticket | DISC-001-01a — Email & Password Authentication |
| Tier | FEATURE |
| Date | 2026-09-28 |
| Verifier | `ddw-module-verifier` (did not write the code) |
| Module | `apps/api/src`, `apps/web/src`, `packages/shared/src` |
| Line coverage | 95.27% (1311/1376) |
| Branch coverage | 92.30% (636/689) |
| Function coverage | 92.74% (345/372) |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Lint | `pnpm lint` (ESLint strictTypeChecked + Prettier --check) — clean; `pnpm typecheck` — clean |

Commands run by the verifier: `pnpm test:coverage` (68 files, 491/491 passed), `pnpm e2e`
(25/25 passed), `pnpm test:perf` (2/2 passed), `pnpm lint`, `pnpm typecheck` — all exit 0.

## Acceptance criteria

Code paths under `apps/api/src/identity/application/` unless noted. Tests assert body and
database state, not only status codes.

- ✅ AC-01 — `registration.test.ts:47`, `auth.spec.ts:52` (register-user.ts:RegisterUser)
- ✅ AC-02 — `registration.test.ts:79`, `auth.spec.ts:102`, `auth.spec.ts:131` (register-user.ts:RegisterUser)
- ✅ AC-03 — `registration.test.ts:94`, `auth.spec.ts:138` (register-user.ts:RegisterUser)
- ✅ AC-04 — `access-control.test.ts:126`, `authenticated-shell-container.test.tsx:75`, `auth.spec.ts:150` (shared/http/require-verified-email.ts)
- ✅ AC-05 — `email-verification.test.ts:64`, `access-control.test.ts:145` (verify-email.ts:VerifyEmail)
- ✅ AC-06 — `email-verification.test.ts:75`, `email-verification.test.ts:111`, `verify-email-container.test.tsx:48`, `auth.spec.ts:167` (verify-email.ts:VerifyEmail)
- ✅ AC-07 — `sign-in.test.ts:47`, `auth.spec.ts:52` (sign-in.ts:SignIn)
- ✅ AC-08 — `sign-in.test.ts:106`, `auth.spec.ts:180` (sign-in.ts:SignIn)
- ✅ AC-09 — `password-reset.test.ts:111`, `auth.spec.ts:229`, `auth.spec.ts:265` (request-password-reset.ts)
- ✅ AC-10 — `password-reset.test.ts:225`, `reset-session-races.test.ts:103`, `reset-session-races.test.ts:151`, `auth.spec.ts:229` (confirm-password-reset.ts)
- ✅ AC-11 — `password-reset.test.ts:250`, `auth.spec.ts:273` (confirm-password-reset.ts)
- ✅ AC-12 — `sessions.test.ts:102` (sign-out.ts:SignOut)
- ✅ AC-13 — `sessions.test.ts:145` (sign-out-all.ts)
- ✅ AC-14 — `access-control.test.ts:102` (shared/http/require-session.ts:createRequireSession)
- ✅ AC-15 — `access-control.test.ts:194` (shared/access/access-policy.ts:OwnerOrGroupMemberAccessPolicy, not-found-unless-allowed.ts)
- ✅ AC-16 — `access-control.test.ts:213` (shared/access/access-policy.ts)
- ✅ AC-17 — `access-control.test.ts:239`, `access-control.test.ts:258` (shared/access/access-policy.ts)
- ✅ AC-18 — `account-defaults.test.ts:10`, `registration.test.ts:112` (domain/account-defaults.ts:newAccountDefaults)
- ✅ AC-19 — `account-defaults.test.ts:20`, `registration.test.ts:112`, `device-context.test.ts:19`
- ✅ AC-20 — `account-defaults.test.ts:29`, `device-context.test.ts:29` (resolveTimeZone) — see warning 6
- ✅ AC-21 — `account-defaults.test.ts:40`, `registration.test.ts:112`, `auth.spec.ts:307`
- ✅ AC-22 — `account-defaults.test.ts:45` (resolveLanguage) — see warning 6

## Spec blocks

- ✅ Block 1 — monorepo foundation; all 9 spec tests present and passing (`test/foundation/*`, `apps/web/test/i18n-catalogs.test.ts`)
- ✅ Block 2 — identity domain, ports and persistence; all 13 spec tests present and passing
- ✅ Block 3 — registration, verification and outbox; all 20 spec tests present and passing (compile-time check `validate.test.ts:122`)
- ✅ Block 4 — sign-in, sessions, sign-out; all 13 spec tests present and passing (`timing.test.ts:49`, `two-instances.test.ts:103`, `test/perf/auth-latency.perf.test.ts`)
- ✅ Block 5 — password reset and credentials version; all 11 spec tests present and passing (race tests in `reset-session-races.test.ts`)
- ✅ Block 6 — access control; all 8 spec tests present and passing; Test-only tables (`test_fixture_resources`, `test_fixture_group_members`) created by `apps/api/test/fixtures/fixture-schema.sql` in the test database only
- ✅ Block 7 — web authentication screens; all 12 spec tests present and passing (8 e2e, `auth-error-messages.test.tsx:51`, `:83`, `device-context.test.ts:19`)
- ✅ Block 8 — outbox hardening; all 8 spec tests present and passing (`email-worker-retry.test.ts:108/131/204/259`, `env.test.ts:72`, `logger.test.ts:77`, `graceful-shutdown.test.ts:60/86`, `migration.test.ts:325/342`)

## Tests

- ✅ Sad-path tests: every input-taking endpoint has at least one — `/auth/register` (validation, short/breached password, 503, 429), `/auth/verify-email` (unknown/malformed/expired/used token), `/auth/verification/resend` (401, 429), `/auth/sign-in` (401, 429 per account and IP, validation), `/auth/refresh` (missing/unknown cookie, reuse, idle 31 days), `/auth/sign-out` (garbage cookie), `/auth/sign-out-all` (401), `/auth/session` (401, tampered token, `alg:none`, expired), `/auth/password-reset/request` (validation, cross-site 403, 429), `/auth/password-reset/confirm` (bad tokens, weak/breached password, 503, concurrent confirms); web forms covered by container tests and e2e. `/health` takes no input.
- ✅ Lint and type checker clean (F-VER-05).

## Warnings

- ⚠️ W-VER-03 — `apps/api/test/two-instances.test.ts`: instances are called directly without a load balancer; `freePort()` has a small bind race.
- ⚠️ W-VER-03 — `apps/api/test/timing.test.ts`: wall-clock median comparison (50 ms) runs in the main suite and may flake on loaded CI runners.
- ⚠️ W-VER-02 — branch coverage below 90% in `register-user.ts` (75%: lines 52, 82), `postgres-attempt-limiter.ts` (66.7%), `drizzle-session-repository.ts` (75%), `registration-routes.ts` (75%), `resend-verification.ts` (83%).
- ⚠️ W-VER-01 — unused exports: `AlertTitle`, `CardFooter` (shadcn scaffolding), `ERROR_CODES`, `errorCodeSchema`, `rateTypeSchema` (`packages/shared`).
- ⚠️ Spec drift not recorded in the decision log: `credentials-version.test.ts` → `reset-session-races.test.ts`; access port `isMember`/`canAccess` → `groupIdsOf`/`scopeFor` with `AccessScope`; deny-all reader under `shared/access/infrastructure/`; `[locale]/page.tsx` → `[locale]/(app)/page.tsx`; "Required tests" checkboxes still `[ ]`.
- ⚠️ AC-20 and AC-22 are unit-tested only; no integration test asserts the stored time zone and language for those inputs (same path as AC-19/AC-21 at `registration.test.ts:112`).

## Note on TDD evidence

The verifier flagged that no per-block red-phase evidence is stored in `docs/ddw/`. TDD evidence is
checked per block in CODE (each block's verifier round received the implementer's evidence); it is
not a §5 rule (F-VER-01..06, W-VER-01..03), so it does not change this verdict. It is recorded here
so the gap is visible: future tickets should persist that evidence in the block reports.

Result: PASSED
