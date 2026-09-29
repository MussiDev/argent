# Verification DISC-001-01b

| Field | Value |
|---|---|
| Ticket | DISC-001-01b — Google Sign-In |
| Tier | FEATURE |
| Date | 2026-09-29 |
| Verifier | `ddw-module-verifier` (did not write the code), on commit `b894c77` |
| Module | `apps/api/src/identity`, `apps/api/src/shared`, `packages/shared/src/auth`, `apps/web/src/features/auth` |
| Line coverage | 95.65% (1607/1680) |
| Branch coverage | 92.24% (785/851) |
| Function coverage | 92.29% (407/441) |
| Coverage floor | 80% lines, 80% branches, 80% functions (AGENTS.md, "Testing") |
| Lint | `pnpm lint` (ESLint strictTypeChecked + Prettier --check) — clean; `pnpm typecheck` — clean |

Commands run by the verifier, all exit 0: `pnpm test:coverage` (76 files, 643/643), `pnpm e2e`
(39/39: 25 from DISC-001-01a and 14 Google flows), `pnpm test:perf` (3/3; Google callback p95
195.1 ms, limit 500 ms), `pnpm lint`, `pnpm typecheck`, `drizzle-kit check`.

## Acceptance criteria

Code in `apps/api/src/identity/application/complete-google-sign-in.ts` (`execute`,
`resolveAccount`) unless noted. API tests in `apps/api/test/identity/google-sign-in.test.ts`, e2e in
`apps/web/e2e/google.spec.ts`. Tests assert database rows, cookies and `Location`, not only status.

- ✅ AC-01 — `google-sign-in.test.ts:288, 317`; e2e `google.spec.ts:87, 274` (resolveAccount create branch)
- ✅ AC-02 — `google-sign-in.test.ts:345, 614`; `apps/web/test/sign-in-container.test.tsx:107`; e2e `google.spec.ts:114` (execute, `denied_at_google`; `google-routes.ts` failure redirect)
- ✅ AC-03 — `google-sign-in.test.ts:359`; e2e `google.spec.ts:164` (`findUserByProviderSubject` branch)
- ✅ AC-04 — `google-sign-in.test.ts:288` (no outbox row); e2e `google.spec.ts:87` (`emailVerifiedAt: now`)
- ✅ AC-05 — `google-sign-in.test.ts:377`; e2e `google.spec.ts:178` (`email_unverified` refusal)
- ✅ AC-06 — `google-sign-in.test.ts:389`; e2e `google.spec.ts:189` (`link`)
- ✅ AC-07 — `google-sign-in.test.ts:408`; e2e `google.spec.ts:214` (`supersedeUnverified`, `revokeAllForUser`, `link`)
- ✅ AC-08 — `google-sign-in.test.ts:437`; e2e `google.spec.ts:236` (`email_unverified` refusal)
- ✅ AC-09 — `google-sign-in.test.ts:455`; e2e `google.spec.ts:253` (`isGoogleAuthoritative` refusal)

NFR-01 — `apps/api/test/perf/google-callback.perf.test.ts:94`. NFR-02 —
`apps/api/test/identity/google-oidc-identity-provider.test.ts` (signature, audience, issuer, `azp`,
expiry, `iat`, nonce, algorithm, `kid`) and `google-sign-in.test.ts:614`.

## Spec blocks

- ✅ Block 1 — persistence: every task done, 8/8 required tests (`google-persistence.test.ts`, `sign-in.test.ts:126`, `email-worker.test.ts:212`, `migration.test.ts:391, 439, 451`); `drizzle-kit check` clean
- ✅ Block 2 — Google OIDC adapter: every task done, 9/9 required tests (`google-oidc-identity-provider.test.ts`, `google-authority.test.ts`, `env.test.ts:136-179`)
- ✅ Block 3 — use cases and routes: every task done, 23/23 required tests (`google-sign-in.test.ts`, `google-sign-in-races.test.ts`, `password-reset.test.ts:419`, `validate.test.ts:176`, perf)
- ✅ Block 4 — web: every task done, 12/12 required tests (9 e2e flows, the cross-site `Lax` flow at `google.spec.ts:130`, component and unit tests)

Decision-log deviations (`findUserByProviderSubject`, `buttonVariants` on an `<a>`) are implemented
as recorded.

## Tests

- ✅ Sad-path tests: `GET /auth/google/start` (over-length and repeated parameter → 400 at `google-sign-in.test.ts:229`, unknown values → defaults `:244`, 21st start refused `:258`, unconfigured provider `:275`); `GET /auth/google/callback` (missing/foreign binding, reused/expired state, repeated `code` `:513-580`, empty values `:582`, over-length → 400 `:597`, token verification failure `:614`, second identity `:474`, 500 fault `:493`, races file); password sign-in for password-less users (`sign-in.test.ts:126`, `sign-in-use-case.test.ts:234`); password reset with identities (`password-reset.test.ts:419`); web `?error=` (`sign-in-container.test.tsx:107, 119, 132`).
- ✅ Lint and type checker clean (F-VER-05).
- ✅ TDD evidence per block in `docs/ddw/reports/tdd-DISC-001-01b.md`; every cited test exists on disk.

## Warnings

- ⚠️ W-VER-02 — per-file business-logic coverage below 90%: `start-google-sign-in.ts` branches 66.66% (`ip ?? UNKNOWN_IP` at :55, rethrow of a non-`GoogleSignInFailed` error at :71); `google-oidc-identity-provider.ts` functions 78.57%; `drizzle-oauth-state-repository.ts` and `drizzle-user-identity-repository.ts` branches 75%.
- ⚠️ W-VER-01 — exports used nowhere else: `GOOGLE_CALLBACK_VALUE_MAX_LENGTH`, `GOOGLE_CALLBACK_MAX_REPEATS`, `GoogleStartQuery`, `GoogleCallbackQuery` (`packages/shared/src/auth/google.ts`), `GOOGLE_START_IP_POLICY`, `GoogleSignInPath`, `RedirectErrorKey`.
- ⚠️ W-VER-03 — wall-clock upper bounds (`google-oidc-identity-provider.test.ts:219, 371`, `elapsed < 2800 ms`) and `127.0.0.1:1` connects (`:386`, `google-sign-in.test.ts:493`) may flake on a loaded or Windows runner; one shared test database, contained by per-test truncation and serial files.
- ⚠️ TDD evidence line numbers from early blocks shifted in later rounds; noted in the evidence file, every test matched by name.

Result: PASSED
