# Verification FEAT-002

| Field | Value |
|---|---|
| Module | web and email i18n catalogs, workspace package scope, `.railway/railway.ts` build commands |
| PRD | docs/ddw/prd/prd-FEAT-002.md |
| Spec | docs/ddw/specs/spec-FEAT-002.md |
| Implementation commits | `74065c2` (Block 1), `ff9457a` (Block 2), `1d9e647` (Block 3) |
| Line coverage | 96.51% |
| Branch coverage | 93.01% |
| Function coverage | 92.93% |
| Coverage floor | 80% (AGENTS.md, "Testing") |
| Lint | `pnpm exec eslint .` — clean; `pnpm typecheck` — clean; Prettier clean on the committed files |
| Cross-verification | `ddw-module-verifier` (an agent that did not write the code): PASSED; re-ran 12 test files (183 tests), `pnpm railway:plan` (up to date) and the public endpoints |

## Acceptance criteria
- ✅ AC-01 — `metadata.title` is "Pesly" in es and en and the PWA manifest takes it (`apps/web/test/i18n-catalogs.test.ts:58, 65`; `locale-layout.test.tsx:61`)
- ✅ AC-02 — the es and en web catalogs hold no Argent product name in any case (`i18n-catalogs.test.ts:70`, leak report `:84`)
- ✅ AC-03 — every email subject and body names Pesly in es and en, and the rendered verification subject does too (`apps/api/test/identity/email-messages.test.ts:61, 65, 75, 87`)
- ✅ AC-04 — the recovery codes file name and first line name Pesly (`i18n-catalogs.test.ts:74`; `two-factor-components.test.tsx:192-207`)
- ✅ AC-05 — the packages resolve as `@pesly/*`; no tracked file outside the history references the old scope; the built API bundles the shared package (`apps/api/test/deploy/package-scope.test.ts:52`; `build-output.test.ts:81`; `pnpm install --frozen-lockfile` up to date)
- ✅ AC-06 — the plan applied listed only the three build commands moving to path filters (`railway-iac.test.ts:289, 299`; `docs/ddw/reports/tests-FEAT-002.md`); the plan is up to date now
- ✅ AC-07 — every build filters by path with the no-match guard flag, and an unmatched path filter exits with code 1 (measured); `railway-iac.test.ts:169, 399`
- ✅ AC-08 — the local default sender is `Pesly <no-reply@pesly.local>` (`apps/api/test/foundation/env.test.ts:107`)
- ⚠️ AC-09 — NOT MET, accepted by the user (2026-10-01): it can only be observed after the merge, which comes after VERIFY. Precondition verified: production builds `main` by path (plan up to date), and the same path-filter commands build the renamed `@pesly/*` packages locally. The post-merge rebuild (three services SUCCESS on the merge commit, `https://pesly.com.ar/es` titled Pesly) is checked at closeout and recorded there.

## Spec blocks
- ✅ Block 1 — path build filters in `74065c2`, applied to production with the user's approval
- ✅ Block 2 — user-visible copy and docs in `ff9457a`
- ✅ Block 3 — package scope in `1d9e647`; its post-merge rebuild (AC-09) is not met before the merge, accepted by the user

## Tests
- ✅ Every test the spec lists exists; the automated ones pass (943 in the full suite) and the manual ones are recorded in the test report
- ✅ Sad-path tests: `build filter error: …` (`railway-iac.test.ts:399`), `product name error: …` (`i18n-catalogs.test.ts:84`, `email-messages.test.ts:87`), `package scope error: …` (`package-scope.test.ts:62`), and the deliberately broken bundling caught by `build-output.test.ts`
- ✅ TDD evidence: Block 1, 2 tests red before the definition change; Block 2, 14 of 16 red before the copy change; Block 3, the scope scan red listing 40 files, plus the build-output mutation
- ✅ Dead code: none (W-VER-01)

## Warnings (non-blocking)
- ⚠️ The spec's file counts for Block 3 are slightly high (15 API source files and 6 test files changed, not 16 and 7); `git grep "@argent"` confirms nothing was missed.
- ⚠️ Remaining internal identifiers, unchanged by decision (PRD Out of Scope): cookie names, `X-Requested-With: argent`, `argent-refresh`, the JWT issuer and audience, Railway service and database names, docker-compose, CI database settings, `.env.example`, `argent.test` fixture domains, and the Mailpit MIME boundary `argent-…`; plus a doc comment example URL in `api-client.ts:112`.
- ⚠️ `CHANGELOG.md`'s working copy has mixed line endings from an earlier local edit; the committed file passes Prettier.
- ⚠️ `package-scope.test.ts` scans untracked files too, so a local scratch file naming the old scope makes it fail; deliberate and commented.

Result: PASSED
