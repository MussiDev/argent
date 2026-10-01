# Verification DISC-001-01d

| Field | Value |
|---|---|
| Ticket | DISC-001-01d — Profile & Preferences |
| Tier | FEATURE |
| Date | 2026-10-01 |
| Verifier | `ddw-module-verifier` (did not write the code), on commit `003276f` (code last changed in `adaf750`) |
| Module | `apps/api/src/identity` (profile, display name, migration `0007`), `packages/shared/src/{profile,money}`, `apps/web/src/features/profile`, `apps/web/src/components/ui/{select,form}.tsx` |
| Line coverage | 93.32% (349/374) over the files this ticket changed; 96.68% repo-wide |
| Branch coverage | 92.44% (208/225) over the files this ticket changed; 92.72% repo-wide |
| Function coverage | 83.45% (121/145) over the files this ticket changed; 93.47% repo-wide |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean; `pnpm exec prettier --check --end-of-line auto .` — clean; `pnpm typecheck` — clean |

Tests: 1059 passed, 0 failed, 0 skipped in the full run; the new tests are named under each acceptance criterion and spec block below.

Commands run by the verifier, all green: `pnpm typecheck`, `pnpm exec eslint .`, prettier check, the
API profile tests on `argent_01d_test` (39/39), and `--project @argent/shared --project web`
(361/361). The implementer's own full run (`pnpm test:coverage`, 103 files, 1059 passed, 0 failed,
0 skipped), the benchmark (p95 100.96 ms against 300 ms) and Playwright (`profile.spec.ts` 3/3, auth
and two-factor regression 27/27) are recorded in `docs/ddw/reports/tests-DISC-001-01d.md`; the
verifier did not re-run Playwright because its ports are shared with other worktrees. Function
coverage of the changed files is pulled down by `schema.ts` (Drizzle table callbacks, 1/18) and
`identity/index.ts` (6/11); without `schema.ts` the aggregate is 94.5%.

Approved deviations, not failures: the migration is `0007` with a deliberate gap at `0006` (reserved
for DISC-001-02a), so `ALL_MIGRATIONS` is 7 on this branch; the profile use cases depend on a narrow
structural interface `TwoFactorStatusReader` that 01c's real `GetTwoFactorStatus` satisfies; three
supporting web files (`saved-notice.tsx`, `use-focus-invalid.ts`, `FormSelect` in `form.tsx`); the
profile routes use `requireSession` only (decision A-3).

## Acceptance criteria

Tests assert bodies, database rows and rendered values, not only status codes.

- ✅ AC-01 — `profile.test.ts` "returns a null display name, the email and 2FA off for a fresh user", "shows twoFactorEnabled true once 2FA is enabled", "does not count a pending 2FA setup as enabled"; `profile-container.test.tsx` "shows an empty display name field when the API sends null (AC-01)" (`get-profile.ts:GetProfile.execute`, `drizzle-profile-repository.ts:findByUserId`)
- ✅ AC-02 — `profile.test.ts` "persists a name of 1 to 50 characters and the next GET shows it", `profile-schemas.test.ts` "accepts 1 and 50 character names and trims them (AC-02)", e2e `profile.spec.ts` edit and save (`profile.ts:displayNameSchema`, `update-profile.ts:UpdateProfile.execute`)
- ✅ AC-03 — `profile.test.ts` "answers 400 for an empty, whitespace-only or 51-character name and keeps the previous one", `profile-persistence.test.ts` check constraint tests (23514), `profile-container.test.tsx` client rejection and "shows a 400 as the generic message above the form and keeps the previous name", e2e empty name refused
- ✅ AC-04 — `profile.test.ts` "rejects an email different from the account, accepts the same one in another case, and rejects an email-only body", `profile-use-cases.test.ts` "raises EmailChangeNotAllowed for a different email and writes nothing" (`update-profile.ts:assertSameEmail`)
- ✅ AC-05 — `profile.test.ts` "returns a rate type and display currency to a new session after sign-out and sign-in", `profile-persistence.test.ts` "persists each preference", e2e sign-out and sign-in
- ✅ AC-06 — same tests as AC-05 (display currency), e2e checks `USD` after signing in again
- ✅ AC-07 — `profile.test.ts` "persists Europe/Madrid, canonicalizing the case", `time-zone.test.ts` "accepts Europe/Madrid in any case and canonicalizes it (AC-07)", e2e
- ✅ AC-08 — `profile.test.ts` "answers 400 and writes nothing for a bad time zone, rate type, currency or language", `time-zone.test.ts` "rejects unknown zones, numeric offsets, empty and oversized values", `profile-container.test.tsx` invalid time zone keeps the previous value
- ✅ AC-09 — `profile-container.test.tsx` "moves to the saved language route after switching the language (AC-09)", "shows every string of the screen from the English catalog in the en locale", `profile-i18n.test.tsx`, e2e language switch to English and back (`profile-container.tsx` `router.replace(pathname, { locale })`)
- ✅ AC-10 — `format-minor-units.test.ts` "uses en-US separators for en and es-AR separators for es (AC-10)" (`1,557.30` and `1.557,30`), "keeps every digit above 2^53" (`format-minor-units.ts:formatMinorUnits`)

NFR-01 — `profile-latency.perf.test.ts` "keeps p95 of PATCH /profile below 300 ms" (500 requests over 8
connections, p95 100.96 ms).

## Spec blocks

- ✅ Block 1 — shared contracts, time zone check and amount formatter: every task done, 11/11 required tests (`profile-schemas.test.ts`, `time-zone.test.ts`, `format-minor-units.test.ts`, `account-defaults.test.ts` "uses the shared display currency and language lists (FR-05)")
- ✅ Block 2 — display name column and profile repository: every task done, 6/6 required tests (`profile-persistence.test.ts`, `migration.test.ts` describe for `0007_profile_display_name`, `identity-infrastructure.test.ts`)
- ✅ Block 3 — profile API: every task done, 15/15 required tests (`profile.test.ts`, `profile-use-cases.test.ts`, `profile-latency.perf.test.ts`)
- ✅ Block 4 — web screen: every task done, 13/13 required tests (`profile-container.test.tsx`, `profile-components.test.tsx`, `profile-i18n.test.tsx`, `profile-errors.test.ts`, `api-client.test.ts`, `auth-components.test.tsx`, `routes.test.tsx`, e2e `profile.spec.ts`)

## Tests

- ✅ Sad-path tests: `GET /profile` without, with a revoked and with an expired session answers 401; `PATCH /profile` answers 400 for an invalid or empty name, time zone, rate type, currency, language, an empty body, unknown keys, a different email and an email-only body, 401 without a session and 403 without the web origin; the repository resolves null for an unknown user and rejects check-constraint violations; the web container covers client-side validation, a 400, a network failure, a 401 on load and on save, and a load failure with retry.
- ✅ Threat model R-01 to R-10 each have the implementation and a test, except that R-02 (markup name rendered as text) and the `cache: 'no-store'` client option of R-06 hold by construction and have no dedicated assertion (WARN-3).

## Warnings (do not block)

- ⚠️ W-VER-02 — branch coverage of some business logic is under 90%: `profile-routes.ts` 50% (the `!auth` fail-closed guards), `time-zones.ts` 50% (the fallback without `Intl.supportedValuesOf`), `time-zone.ts` 85.7%, `update-profile.ts` 86.4%, `drizzle-profile-repository.ts` 83.3% (empty-changes branch); all defensive paths, every file clears 80% lines.
- ⚠️ W-VER-03 — the second test of the `0007` migration `describe` (`migration.test.ts`) depends on the user inserted by the first one, and the migration test uses the database `argent_migration_test`, shared by name across worktrees.
- ⚠️ W-VER-01 — `ProfileFieldErrorKey` and `ProfileField` are exported but used only inside `profile-errors.ts`; `TIME_ZONE_MAX_LENGTH` exists in shared and in `account-defaults.ts` (accepted, SAST I-2); `formatMinorUnits`, `isIanaTimeZone`, `canonicalTimeZone` have no `src` consumer yet (intended, decision D-4).
- ⚠️ The Block 3 line "enabled through 01c's flow" is covered with the `seedTwoFactor` repository helper, not the HTTP enable flow; the pending-setup test does use `/auth/2fa/setup`.
- ⚠️ AC-09 is tested on the profile screen and the nav link; other screens rely on the existing locale routing.
- ⚠️ Merge note: the migration chain here is 0005 to 0007; when DISC-001-02a's `0006` lands, `migration.test.ts` needs the `0006` rollback and `ALL_MIGRATIONS` becomes 8, and the journal `when` of `0007` must stay later than 02a's entry (SAST I-1).

Result: PASSED
