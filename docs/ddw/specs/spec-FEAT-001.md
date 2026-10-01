# Spec FEAT-001: Define the Pesly Railway services as Infrastructure as Code

| Field | Value |
|-------|-------|
| Ticket | FEAT-001 |
| PRD | docs/ddw/prd/prd-FEAT-001.md |
| Tier | FEATURE |
| Date | 2026-10-01 |
| Spec loops | 1 |
| Loops since last human decision | 1 |

## Summary

A Railway Infrastructure as Code partial, `.railway/railway.ts`, written with the `railway` SDK
(`railway/iac`, pinned 3.12.0 as a development dependency), declares the four Pesly services with
the build, start, pre-deploy, watch path, restart and variable settings that FIX-002 and FIX-003
put in production by hand. Secrets are `preserve()`d, so no value lives in the repository. A Vitest
test runs the definition in-process and checks every setting and every secret. The three deprecated
`railway*.json` files and their test are removed. Railway's CLI is installed globally by the user
(user decision 2026-10-01: the repository does not pin `@railway/cli`, so no install downloads its
binary); the root scripts `railway:plan` and `railway:apply` call it. The first plan against
production must show no differences before anything is applied.

## Coverage: PRD → blocks

| Requirement | Covered by |
|---|---|
| FR-01 | Block 1 (definition), Block 2 (plan against production) |
| FR-02 | Block 1 |
| FR-03 | Block 1 |
| FR-04 | Block 1 (scripts), Block 2 (first run) |
| FR-05 | Block 1 |
| NFR-01 | Block 2: the plan output is reviewed and must list 0 creations, 0 deletions and 0 changes |
| NFR-02 | Block 1: the secrets test (AC-05) and `preserve()` for every secret |
| NFR-03 | Strategy: `railway` is added only to `devDependencies`; `pnpm audit --prod` and the API bundle do not include it |
| NFR-04 | Strategy: no file under `apps/*/src` or `packages/shared/src` changes; the full suite runs with coverage at closeout |

## Dependencies between blocks

Block 2 depends on Block 1: production is planned against the definition Block 1 writes. Block 1
is implemented and merged-ready first; Block 2 runs before the pull request is merged, and any
value it reconciles is committed in Block 1's files.

## Block 1 — Definition, scripts and test

**Files**
- `.railway/railway.ts` (new) — the partial: `export const partial = 'pesly'` and a default export
  built with `defineRailway`.
- `package.json` (modified) — devDependency `railway` `3.12.0` (exact); scripts
  `railway:plan` = `railway config plan --environment production` and
  `railway:apply` = `railway config apply --environment production`.
- `apps/api/package.json` (modified) — devDependency `railway` `3.12.0` (exact), so the API's test
  project can resolve `railway/iac`.
- `pnpm-lock.yaml` (modified) — lockfile update from `pnpm install`.
- `tsconfig.json` (modified) — add `.railway/railway.ts` to `include`, so `pnpm typecheck` and the
  type-aware ESLint rules cover it.
- `apps/api/test/deploy/railway-iac.test.ts` (new) — replaces the deleted test.
- `apps/api/test/deploy/railway-config.test.ts` (deleted).
- `apps/api/railway.json`, `apps/api/railway.worker.json`, `apps/web/railway.json` (deleted).

**Logic**

`.railway/railway.ts` declares, inside one `project(...)`:

- `postgres('argent-postgres')` with no further settings (image, volume and networking are out of
  scope and stay as Railway has them).
- Three services, each with `source: github('MussiDev/pesly', { branch: 'main' })` and
  `deploy: { restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 10 }`:

| Service | `build.buildCommand` | `start` | `preDeploy` |
|---|---|---|---|
| `argent-api` | `pnpm --filter @argent/api build` | `node --max-old-space-size=320 apps/api/dist/server.js` | `['node apps/api/dist/shared/db/migrate.js']` |
| `argent-worker` | `pnpm --filter @argent/api build` | `node --max-old-space-size=192 apps/api/dist/worker.js` | none |
| `argent-web` | `pnpm --filter @argent/web build` | `node --max-old-space-size=320 apps/web/node_modules/next/dist/bin/next start apps/web` | none |

- `build.builder` is `'RAILPACK'` for all three. `build.watchPatterns` is
  `['apps/api/**', 'packages/shared/**', 'pnpm-lock.yaml']` for the API and worker and
  `['apps/web/**', 'packages/shared/**', 'pnpm-lock.yaml']` for the web.
- Variables (`env`):
  - `argent-api`: `NODE_ENV`, `LOG_LEVEL`, `WEB_BASE_URL`, `WEB_ORIGIN`, `API_ORIGIN`,
    `EMAIL_PROVIDER`, `EMAIL_FROM`, `BREACH_CHECKER`, `TRUST_PROXY` as literal values;
    `DATABASE_URL` as a reference to `argent-postgres`'s `DATABASE_URL` (private network);
    `JWT_SECRET`, `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` as `preserve()`.
  - `argent-worker`: only the seven settings `parseWorkerEnv` reads (FIX-003) — `NODE_ENV`,
    `LOG_LEVEL`, `WEB_BASE_URL`, `EMAIL_PROVIDER`, `EMAIL_FROM` as literals, `DATABASE_URL` as the
    same reference, `RESEND_API_KEY` as `preserve()`.
  - `argent-web`: `NODE_ENV` and `API_ORIGIN` as literals.
  - The literal values are the ones in production today; Block 2 confirms each against
    `railway config pull` and corrects any mismatch here.
- The file exports only the partial name and the default program; the expected lists live in the
  test (architecture review, spec loop 1), so the definition is never checked against itself.

`apps/api/test/deploy/railway-iac.test.ts` hard-codes what the PRD requires: the four owned
service names (FR-01), the four secret names (FR-03), and per service the allowed literal variable
names (the worker's seven settings from FIX-003). It asserts that every variable outside a
service's allowed literal set is `preserve()` (or the `DATABASE_URL` reference), so a secret
turned into a literal fails even if it was also dropped from any list. It also asserts that the
`railway` version in the root and `apps/api` `package.json` is the same exact string, so the
definition's `defineRailway` and the test's `createRailwayContext` come from one copy.

The test lives in the API test project on purpose: that project already hosts the repository-wide
deploy tests (`build-output.test.ts`), and importing `.railway/railway.ts` from there puts the
definition under `tsc -p apps/api` and Vitest without a new test project. It runs fully offline and
without a Railway token: it only evaluates the program in-process; any network access would be a
defect, so the implementation confirms in the SDK source that `createRailwayContext` and `project`
are pure builders, and the test runs with no `RAILWAY_TOKEN` in its environment.

The test imports the default program, runs it with
`createRailwayContext({ environment: 'production' })` and the SDK's `project` helper, and reads the
resulting service nodes (`build`, `deploy`, `variables`). A small pure helper in the test,
`literalSecrets(services, secretNames)`, returns `service.variable` for every secret whose value is
not of type `preserve`; the test asserts it returns an empty list for the real definition and
exercises it against a hand-built node with a literal secret. Two more pure helpers in the test,
`serviceSetDifference(expected, found)` and `heapCapIssues(services, caps)`, report a missing or
extra service by name and a start command whose `--max-old-space-size` is missing or different,
naming the service; each is asserted empty for the real definition and exercised against
hand-built nodes.

**Input validation**
- The definition takes no runtime input. Its shape is checked by the SDK's TypeScript types
  (`pnpm typecheck`) and by `validateGraph` when the CLI compiles it.

**Error handling**
- A secret given a literal value — the test fails with a message naming `service.VARIABLE`
  (AC-05); the definition must not be applied until it passes.
- A service missing, renamed or added in the definition — the test that lists the owned services
  fails, naming the expected and found sets.
- A start command without its heap cap, or with a different one — the test fails naming the
  service and the expected `--max-old-space-size` value.

**Required tests**
- [ ] the definition owns exactly `argent-api`, `argent-worker`, `argent-web` and
      `argent-postgres`, and declares the `pesly` partial — validates AC-01
- [ ] each application service builds with RAILPACK and its build command, and watches its paths —
      validates AC-03
- [ ] each application service restarts `ON_FAILURE` with at most 10 retries — validates AC-03
- [ ] start commands cap the heap at 320 MB (API, web) and 192 MB (worker), and the web starts with
      `node` directly — validates AC-03
- [ ] only the API runs the migration as its pre-deploy command — validates AC-03
- [ ] each service declares its non-secret variables, and the worker declares nothing beyond its
      seven settings — validates AC-04
- [ ] every secret variable is preserved, and every variable outside a service's allowed literal
      set is preserved or a reference — validates AC-04
- [ ] the `railway` version pinned in the root and `apps/api` `package.json` is identical —
      validates AC-03
- [ ] sad path: a secret given a literal value is reported by name — validates AC-05
- [ ] sad path: a service missing, renamed or added in the definition is reported with the expected
      and found sets — validates AC-01
- [ ] sad path: a start command without its heap cap, or with a different one, is reported naming
      the service and the expected cap — validates AC-03
- [ ] no `railway.json` or `railway.worker.json` exists under the repository's `apps/` — validates
      AC-07

**Completion criterion**
`pnpm test` passes with the new test file (all the tests above green), `pnpm typecheck` and
`pnpm lint` are clean with `.railway/railway.ts` included, `pnpm audit --prod --audit-level high`
and `pnpm audit --audit-level high` (development dependencies included, to cover the new SDK and
its `graphql` and `tsx` dependencies) are clean, and `git ls-files` lists no `railway.json` or `railway.worker.json`.

## Block 2 — Adoption against production

**Files**
- `.railway/railway.ts` (modified, only if needed) — literal values corrected to match production.

**Logic**
1. The user installs the CLI globally (`npm i -g @railway/cli`); `railway --version` must report
   5.63.1 or later (the version checked when this spec was written) before any plan runs. The user
   then runs `railway login` and
   `railway link` to the Pesly project's production environment. Credentials are never handled by
   the agent.
2. `railway config pull` runs in a scratch directory outside the repository, and its output is
   compared with `.railway/railway.ts` for the four owned services. Any literal that differs is
   corrected in the repository; preserved secrets are not compared and never copied.
3. `pnpm railway:plan` runs. Its output must list 0 services created, 0 deleted, 0 changes to
   services outside the partial and 0 changes to the owned services (NFR-01, AC-01, AC-02, AC-06).
4. If the plan is empty, nothing is applied. If it lists only changes the user explicitly accepts,
   the user runs `pnpm railway:apply`, and a second plan must then be empty (AC-06).

**Error handling**
- The plan lists a creation or deletion of any service — stop; nothing is applied; the definition
  is corrected (most likely a name mismatch) and the plan is run again.
- The plan lists a change outside the partial — stop; nothing is applied; the partial declaration is
  fixed before continuing.
- The plan lists a change to an owned service — the value in production is the reference: the
  definition is corrected to match unless the user decides the production value is wrong.
- `railway config pull` output contains secret values — it stays in the scratch directory, is
  never committed, and is deleted after the comparison.
- The global `railway` CLI missing or not linked — `pnpm railway:plan` exits non-zero with the
  CLI's own message; nothing is applied until the user installs and links it.
- The global CLI older than 5.63.1 — no plan runs until it is upgraded.

**Required tests** *(manual checks, recorded in the test report)*
- [ ] sad path: a plan that lists a creation or deletion of any service stops the adoption, and
      the first `pnpm railway:plan` against production lists none — validates AC-01
- [ ] sad path: a plan that lists a change outside the partial stops the adoption, and the plan
      lists none — validates AC-02
- [ ] sad path: a plan that lists a change to an owned service is reconciled to the production
      value, and the final plan lists no differences — validates AC-06
- [ ] sad path: the pull output with secret values never enters the repository (`git status` clean
      of it) and is deleted after the comparison — validates AC-04
- [ ] sad path: with the global `railway` CLI missing or not linked, `pnpm railway:plan` exits
      non-zero and nothing is applied — validates AC-06
- [ ] sad path: a global CLI older than 5.63.1 is upgraded before any plan runs; `railway --version`
      is recorded in the test report — validates AC-06

**Completion criterion**
The recorded plan output (pasted in the test report, with no secret values) shows 0 creations,
0 deletions and 0 changes, and the services stay Online.

## Final verification

- `git ls-files` lists `.railway/railway.ts` and no `railway.json` / `railway.worker.json`.
- `pnpm test:coverage`, `pnpm typecheck`, `pnpm lint` and `pnpm audit --prod --audit-level high` are
  clean; coverage stays at or above 80/80/80.
- `pnpm railway:plan` against production reports no differences.
- A search of the repository finds no secret value for `JWT_SECRET`, `RESEND_API_KEY`,
  `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET`.
