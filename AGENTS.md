# AGENTS.md — Pesly

## Language

- Conversation with the user: the language the user writes in.
- Working language for artifacts (code, identifiers, comments, docs, PRDs, specs, ADRs, commit
  messages): **English**.
- User-facing UI copy: **Spanish and English** (bilingual interface, PRD 01 FR-26). Never hardcode
  UI strings; every string goes through the i18n catalogs.

## What this project is

Pesly is a mobile-first PWA to manage personal and shared finances in Argentina: accounts and
daily movements in ARS and USD with frozen exchange rates, credit cards with installments,
Splitwise-style groups and households, savings goals, budgets, investments and recurring
payments — usable offline at the moment of paying.

**Reference:** `docs/ddw/discovery/concept-DISC-001.md` and the PRDs in `docs/ddw/prd/`
(`prd-DISC-001-01.md` to `prd-DISC-001-10.md`).

## Stack

| Field | Value |
|-------|-------|
| Language | TypeScript (strict mode) |
| Runtime | Node.js 24 LTS |
| Frontend | Next.js 16 (App Router) + React; PWA manifest via `app/manifest.ts`; offline service worker via Serwist; local queue in IndexedDB |
| UI | Tailwind CSS + shadcn/ui (Radix primitives), Lucide icons; light and dark themes via CSS variables |
| Backend | Express 5 REST API (stateless), hexagonal architecture; request/response validation and typing with Zod schemas from `packages/shared` |
| Database | PostgreSQL + Drizzle ORM (SQL migrations) |
| Test runner | Vitest (unit/integration), Playwright (end-to-end, including offline flows) |
| Linter / formatter | ESLint + Prettier |
| Package manager | pnpm workspaces (monorepo) |
| Install | `pnpm install --frozen-lockfile` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Build | `pnpm --filter ./apps/api --fail-if-no-match build`, `pnpm --filter ./apps/web --fail-if-no-match build` |
| Audit | `pnpm audit --prod --audit-level high` |

## Architecture conventions

- **Monorepo layout:**
  - `apps/web` — Next.js frontend (UI only).
  - `apps/api` — Express API.
  - `packages/shared` — types, validation schemas and money/date utilities shared by both.
- **API (hexagonal):** `apps/api/src/<module>/` with `domain/` (entities, value objects, pure
  rules), `application/` (use cases, ports), `infrastructure/` (Drizzle repositories, HTTP
  routes, external adapters). Domain never imports from infrastructure.
- **Modules follow the PRDs** (screaming architecture): `identity`, `accounts`, `categories`,
  `movements`, `exchange-rates`, `sync`, `groups`, `budgets`, `goals`, `investments`, `recurring`,
  `credit-cards`, `reports`.
- **Approved exception to the i18n catalogs:** default category names (Spanish and English) live in
  `packages/shared/src/categories` because the API enforces name uniqueness across languages; every
  other string stays in the i18n catalogs.
- **Frontend:** container/presentational split; presentational components are pure and have no
  data fetching.
- **UI components:** shadcn/ui components live in `apps/web/src/components/ui/` as owned source
  and may be edited there; feature components compose them and never restyle them ad hoc. Colors,
  radii and spacing come from theme tokens (CSS variables), never hardcoded values. Server Components and Server Actions never touch financial data — all financial
  data goes through the Express API.
- **External services behind adapters:** dolarapi.com (rates), CoinGecko (crypto prices), Google
  OAuth, the email provider and Web Push each live behind a port with one adapter, so they can be
  replaced.
- **Stateless API:** no session or cache state in process memory (PRD 01 NFR-09).
- **Validation and typing:** every route validates params, query and body with a Zod schema
  from `packages/shared` through one shared validation middleware, and handlers receive the
  inferred types; responses are typed with the same schemas. No route reads `req.body`
  unvalidated.
- **Error handling:** typed domain errors mapped to HTTP responses in one Express error
  middleware; no silent `catch`.
- **Naming:** files in kebab-case, React components in PascalCase, database tables and columns in
  snake_case.
- **Dependencies:** a new runtime dependency is justified in the spec before it is added.

## Code conventions

- **Money is never a float.** Amounts are 64-bit integers in minor units (`bigint` in TypeScript,
  `bigint` in PostgreSQL); exchange rates are integers scaled by 10,000; investment quantities
  are integers scaled by 10^8. All money arithmetic goes through `packages/shared` helpers.
- **Rounding leftovers are deterministic:** leftover minor units go to the payer first (groups)
  or to the first installment (credit cards).
- **Dates:** stored in UTC; "today", "this month" and schedules are computed in the user's time
  zone (PRD 01 FR-24).
- **Every query on user data is scoped by owner or group membership**; access to data that is not
  the user's answers 404, never 403.
- No `any`. If it is unavoidable, it carries a comment explaining why.
- Validate every API input with the shared Zod schemas; never trust an unvalidated `req`.
- Comments only when the *why* is not obvious from the code.

## Testing

- Commands: `pnpm test` (unit and integration, needs PostgreSQL via `TEST_DATABASE_URL`),
  `pnpm test:coverage` (same suite with V8 coverage and thresholds), `pnpm test:perf` (latency
  benchmarks), `pnpm e2e` (Playwright, needs PostgreSQL via `E2E_DATABASE_URL` and Mailpit).
- **Coverage floor: 80% lines, 80% branches, 80% functions**, measured by Vitest over
  `apps/api/src`, `apps/web/src` and `packages/shared/src` together. The web app counts too: its
  containers and components need Vitest tests, not only Playwright flows.
- Every acceptance criterion has at least one test; every input has at least one sad-path test.

## What NOT to do in this project

- Do not store broker or bank credentials, and do not scrape third-party sites.
- Do not use floating point for money, rates or quantities — anywhere, including tests.
- Do not call dolarapi.com or CoinGecko in the request path of a user action; use stored values.
- Do not call real external services (dolarapi.com, CoinGecko, Google, email, push) in tests; use
  the adapters' fakes.
- Do not show amounts or account names in push notification text.
- Do not hardcode UI strings or number/date formats; use the i18n catalogs and locale formatters.
- No destructive database migrations without an explicit plan.

## Domain glossary

- **Account:** a place where money is, with exactly one currency (ARS or USD).
- **Movement:** an expense, income, transfer or currency exchange on the user's accounts.
- **Currency exchange:** buying or selling USD; moves money between an ARS and a USD account; it
  is neither an expense nor an income.
- **Rate type:** one of the seven ARS/USD quotes (oficial, blue, bolsa/MEP, contado con
  liquidación, mayorista, cripto, tarjeta).
- **Frozen rate:** the ARS-per-USD rate stored on a movement when it is recorded; never changes
  afterwards.
- **Group:** people who split expenses; a household is a permanent group.
- **Share:** the part of a group expense assigned to one member; only the member's share counts
  as their personal expense.
- **Receivable:** what group members owe the user; not an expense.
- **Settlement:** a recorded payment between group members; neither expense nor income.
- **Ghost member:** a group member without an account, claimable later through a claim link.
- **Statement:** a credit card billing cycle with a closing date and a due date.
- **Installment (cuota):** one part of a purchase paid over several statements; counts as an
  expense in the month of its statement's due date.
- **Pending debt:** installments assigned to statements not yet closed.
- **Portfolio / holding:** a group of investments (usually one per broker) and one position in it.
- **Occurrence:** one due date of a recurring payment; automatic or pending confirmation.
