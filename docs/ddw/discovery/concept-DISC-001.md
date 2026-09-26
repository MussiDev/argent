# Concept: Personal and Shared Finance PWA

| Metric | Value |
|--------|-------|
| Ticket | DISC-001 |
| Date | 2026-09-25 |
| Status | Formalizing |

## Vision
A progressive web app to manage personal finances in one place: daily expenses, savings,
investments, and expenses shared across accounts.

## Problem / Opportunity
_To be defined._

## Target Users
Three usage contexts, all supported by the same product:
- **Individual** — one person managing their own money across multiple accounts/wallets
  (bank accounts, cash, cards), including transfers between them.
- **Household** — a couple or family with partially shared finances.
- **Groups** — ad-hoc groups (friends, trips, roommates) splitting expenses and tracking
  who owes whom (Splitwise-style).

## Candidate Features
- Accounts / wallets — multiple money accounts per user, with transfers between them
- Daily expense tracking — record and categorize everyday spending
- Savings balances — savings are accounts; balances per account and currency
- Savings goals — target amount and date, progress and required monthly contribution
- Budgets — spending limits per category and period, with alerts
- Investments — track investment holdings and their value
- Recurring payments & reminders — rent, utilities, subscriptions; generated movements and
  notifications
- Dashboard & reports — net worth (ARS/USD), spending by month and category
- Group expense splitting — split expenses, track balances and settle debts. A household is a
  permanent group; split rules: equal or proportional (e.g. to income), periodic settlement
- PWA — installable, mobile-first experience

## Constraints and Considerations
- **Scale:** public product, initial reach of at most ~10 users, with future growth in mind.
  - **In scope — design for scalability:** stateless backend (horizontally scalable),
    tenant-scoped data model (user/household/group), proper indexes, pagination on every
    list, money stored as integer minor units (never floats), key decisions recorded as ADRs.
  - **Out of scope — scale optimization:** distributed caching, sharding, queues, read
    replicas. Revisit only when production metrics show a bottleneck.
- **Currencies:** ARS and USD.
  - Rates sourced from dolarapi.com (oficial, blue, bolsa/MEP, CCL, mayorista, cripto, tarjeta),
    fetched periodically by the backend and stored — no live dependency at entry time.
  - Default rate type is configurable per user (personal finances) and per group/household.
  - On entry, the default rate is prefilled and editable; every movement persists the rate
    used and its source (automatic <type> / manual), so historical balances never change.
  - If the provider is down, the last stored rate is used and its age is shown.
- **Investments:**
  - Balanz (user's broker) has no public API for client holdings.
  - MVP: manual entry + import of the broker's holdings report file. Export format (Excel/CSV/PDF)
    pending confirmation — determines import feasibility.
  - Storing broker credentials / scraping is explicitly rejected (security, ToS, fragility).
  - Future (out of scope): official broker API integrations (e.g. IOL public API).
- **Offline:** offline entry — movements can be recorded without connectivity and are synced
  when back online. Requires a local change queue, conflict resolution for shared
  movements, and cached FX rates on device. Full offline browsing is out of scope.
- **Security:** real users' financial data — authentication, per-user data isolation and
  per-context authorization are mandatory regardless of the small scale.

## Decisions Made
- 2026-09-25: Delivered as a PWA — stated by the user as a starting requirement.
- 2026-09-25: "Shared" covers three contexts — own accounts/wallets, household, and
  Splitwise-style groups — implies multi-user with invitations and per-context permissions.
- 2026-09-25: Public product with small reach (≤10 users) — scale is not a driver; security
  and data isolation still are.
- 2026-09-25: Supported currencies: ARS and USD.
- 2026-09-25: Design for scalability from day one, but no premature scale optimization —
  optimizing without real load means guessing the bottleneck and paying complexity up front.
- 2026-09-25: FX conversion = automatic by default, editable per movement; default rate type
  configurable per user and per group; rate frozen on each movement.
- 2026-09-25: Investments = manual entry + broker report import; no credential storage or
  scraping — a breach would expose the user's brokerage account.
- 2026-09-25: Offline entry with later sync — recording an expense at the moment of payment is
  the core use case and must not depend on connectivity.
- 2026-09-25: Household = a permanent group (each member pays, costs are split and settled
  periodically). No shared-pot model — one "group" concept covers households and ad-hoc groups.
- 2026-09-25: Savings scope = balances (as accounts) + goals + category budgets with alerts.
- 2026-09-25: Split approved into 9 PRDs (see table). Accounts & categories separated from
  movements to keep PRDs reviewable; recurring payments and reminders grouped together.
- 2026-09-25: Credit cards modeled with statement cycle (closing/due dates) and installment
  purchases spread over future statements. Split into its own PRD 10 so PRD 02 only declares the
  credit card account type.
- 2026-09-25: Categories are predefined and editable per user, with one level of subcategories.
- 2026-09-25: Buying/selling USD is a cross-currency transfer (ARS out of one account, USD into
  another) with the implied rate stored; it is neither an expense nor an income.

## Identified PRDs

| # | Title | File | Status | Depends on |
|---|-------|------|--------|------------|
| 1 | Identity & Access | prd-DISC-001-01.md | validated | — |
| 2 | Accounts & Categories | prd-DISC-001-02.md | validated | 1 |
| 3 | Movements & Exchange Rates | prd-DISC-001-03.md | validated | 2 |
| 4 | Offline Entry & Sync | prd-DISC-001-04.md | identified | 3 |
| 5 | Groups & Expense Splitting | prd-DISC-001-05.md | identified | 1, 3 |
| 6 | Savings Goals & Budgets | prd-DISC-001-06.md | identified | 2, 3 |
| 7 | Investments | prd-DISC-001-07.md | identified | 1, 3 |
| 8 | Recurring Payments & Reminders | prd-DISC-001-08.md | identified | 3 |
| 9 | Dashboard & Reports | prd-DISC-001-09.md | identified | 3, 6, 7 |
| 10 | Credit Cards: Statements & Installments | prd-DISC-001-10.md | identified | 2, 3 |
