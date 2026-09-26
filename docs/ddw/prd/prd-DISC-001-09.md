# PRD DISC-001-09: Dashboard & Reports

| Field | Value |
|-------|-------|
| Ticket | DISC-001 |
| Tracker | none |
| Date | 2026-09-25 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Every other module of the finance PWA (see `docs/ddw/discovery/concept-DISC-001.md`) records one
slice of the user's money: accounts and movements (PRD 02, 03), group debts (PRD 05), budgets
and goals (PRD 06), investments (PRD 07), recurring payments (PRD 08) and credit cards (PRD 10).
Nothing yet answers the questions users open the app for: how much am I worth, how much did I
spend this month and on what, what is coming, and what needs my attention. This PRD defines the
home dashboard and the reports, and the rules that make their numbers consistent with the rest
of the app.

## Goals
- A home dashboard that answers, at a glance: net worth, this month's spending and income,
  where the money went, budgets at risk, what is due soon, and what needs action.
- Reports over time: spending by category, income vs expenses, net worth evolution.
- One consistent conversion rule: flows use each movement's frozen rate; current net worth uses
  today's rate (decision 2026-09-25).
- A visual style in the direction of the user's references (see Design Reference).

## Design Reference
The user provided two reference dashboards (2026-09-25; source posts on X:
`x.com/nazmijavierl/status/2099784026794188975` and
`x.com/suniljoshi19/status/2088593453756428323`). Traits to carry over:
- A row of KPI cards on top, each with a large value and a colored delta chip vs the previous
  period (green for favorable, red for unfavorable).
- One large area chart with a hover/tap tooltip showing date and value.
- Rounded cards on a neutral background, generous spacing, restrained color: color is reserved
  for meaning (deltas, status pills, category series).
- Status pills in plain words (for example "On track", "Close", "Over").
- An action list ("Do these first") and a one-sentence plain-language insight callout.
- Sidebar navigation on wide screens; one reference is dark, the other light — both themes are
  supported.
- The first reference lists Radix UI and Lucide icons; the component library is chosen in PLAN.

These traits are direction, not pixel specification; the measurable parts are in NFR-03 to
NFR-06.

## Functional Requirements
- FR-01: The system must show on the dashboard the user's net worth: the sum of their account
  balances and investment values, plus what group members owe them, minus what they owe group
  members, minus their credit card installments in statements not yet closed.
- FR-02: The system must show the net worth in the user's display currency (PRD 01, FR-21),
  converting the other currency with today's rate of the user's default rate type.
- FR-03: The system must show the net worth broken down per currency (ARS and USD) without
  conversion.
- FR-04: The system must show a KPI card with the current month's expenses: personal expenses,
  group expense shares (PRD 05) and credit card installments of the month (PRD 10).
- FR-05: The system must show a KPI card with the current month's income.
- FR-06: The system must show a KPI card with the current month's net result (income minus
  expenses).
- FR-07: The system must show on each KPI card the percentage change against the same period of
  the previous month.
- FR-08: The system must show a net worth chart with one point per month end for the last 12
  months, with a tooltip showing the date and value of the selected point.
- FR-09: The system must show the current month's expenses by top-level category, with amount and
  share of the total.
- FR-10: The system must show up to 3 budgets (PRD 06) with the highest percentage used, each
  with a status: "On track" below 80%, "Close" from 80% to 99%, "Over" from 100%.
- FR-11: The system must list the recurring payment occurrences (PRD 08) and credit card statement
  due dates (PRD 10) of the next 7 days, ordered by date.
- FR-12: The system must show a "Do these first" list with the items that need the user's action:
  pending occurrences to confirm, overdue occurrences, group conflicts and failed syncs (PRD 04),
  and unpaid credit card statements due within 3 days.
- FR-13: The system must show the total that group members owe the user and the total the user
  owes, per currency.
- FR-14: The system must show one plain-language insight about the current month: the category
  with the highest spending, its share of total spending and its change against the average of
  the previous 3 months.
- FR-15: The system must provide a report of expenses by category for a date range of up to 24
  months.
- FR-16: The system must provide a report of income and expenses per month for the last 12
  months.
- FR-17: The system must provide a report of net worth per month end for a date range of up to 24
  months.
- FR-18: The system must allow a user to filter the reports of FR-15 and FR-16 by account, tag and
  date range.
- FR-19: The system must convert income and expenses in reports and KPI cards to the display
  currency with the rate frozen on each movement (PRD 03).
- FR-20: The system must convert each past month-end net worth point with the latest rate stored
  on or before that month end for the user's default rate type.
- FR-21: The system must show a first-steps guide (create an account, record a movement) instead of
  empty charts when the user has no accounts or no movements.
- FR-22: The system must include in the dashboard and reports only data the user owns and their
  own shares of group expenses.
- FR-23: The system must allow a user to choose light theme, dark theme or the system setting,
  with the system setting as default.

## Non-Functional Requirements
- NFR-01: The dashboard data must be returned in < 1 s at p95, measured server-side, for a user
  with 100,000 movements, 50 budgets, 500 holdings and 10 groups.
- NFR-02: Each report must be returned in < 2 s at p95, measured server-side, for a 24-month
  range over 100,000 movements.
- NFR-03: The dashboard must reach Largest Contentful Paint in < 2.5 s at p75 on a mid-range phone
  over 4G (reference: 4 GB RAM, 2021 hardware; 10 Mbps down, 50 ms latency).
- NFR-04: The dashboard and reports must be usable from 360 px to 1920 px wide with 0 horizontal
  scroll; screens of 1024 px or wider must use a sidebar navigation, narrower screens a bottom
  navigation bar.
- NFR-05: Text must have a contrast ratio of at least 4.5:1 against its background in both themes
  (WCAG 2.1 AA).
- NFR-06: Delta chips and status pills must convey their meaning with text or a sign (+/−) in
  addition to color, so that 100% of them remain readable without color (WCAG 2.1, 1.4.1).

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user has accounts totaling 1,000,000.00 ARS, investments of 500,000.00
  ARS, group receivables of 50,000.00 ARS, group debts of 20,000.00 ARS and pending installments of
  110,000.00 ARS, THE system SHALL show an ARS net worth of 1,420,000.00 ARS.
- AC-02 (FR-02): WHEN a user with display currency ARS has 1,000.00 USD and today's sell rate of
  their default type is 1,500.0000, THE system SHALL count those dollars as 1,500,000.00 ARS in
  the net worth.
- AC-03 (FR-02): IF no rate has ever been stored, THEN THE system SHALL show the net worth per
  currency only and state that the conversion is unavailable.
- AC-04 (FR-03): WHEN a user opens the dashboard, THE system SHALL show the ARS and USD net worth
  components separately, without conversion.
- AC-05 (FR-04): WHEN in October a user has personal expenses of 200,000.00 ARS, group shares of
  30,000.00 ARS and installments of 10,000.00 ARS, THE system SHALL show October expenses of
  240,000.00 ARS.
- AC-06 (FR-05): WHEN in October a user records incomes of 800,000.00 ARS, THE system SHALL show
  October income of 800,000.00 ARS.
- AC-07 (FR-06): WHEN October income is 800,000.00 ARS and expenses are 240,000.00 ARS, THE system
  SHALL show a net result of 560,000.00 ARS.
- AC-08 (FR-07): WHEN expenses up to October 15 are 240,000.00 ARS and expenses up to September 15
  were 200,000.00 ARS, THE system SHALL show a change of +20% on the expenses card.
- AC-09 (FR-07): IF the previous month's value for the same period is 0, THEN THE system SHALL
  show "—" instead of a percentage.
- AC-10 (FR-08): WHEN a user taps or hovers a point of the net worth chart, THE system SHALL show
  a tooltip with that month end's date and net worth.
- AC-11 (FR-08): WHEN a user opens the dashboard, THE system SHALL draw 12 month-end points, or
  one per month since their first movement if that is fewer.
- AC-12 (FR-09): WHEN October expenses are 120,000.00 ARS in Food and 80,000.00 ARS in Transport,
  THE system SHALL show Food with 120,000.00 ARS and 60%, and Transport with 80,000.00 ARS and 40%.
- AC-13 (FR-10): WHEN a user has budgets at 50%, 85%, 105% and 30% used, THE system SHALL show the
  105% budget as "Over", the 85% one as "Close" and the 50% one as "On track", in that order.
- AC-14 (FR-11): WHEN a user has a recurring payment due in 3 days and a card statement due in 6
  days, THE system SHALL list both, the payment first.
- AC-15 (FR-12): WHEN a user has one pending occurrence, one group conflict and one unpaid
  statement due in 2 days, THE system SHALL list those 3 items in "Do these first", each linking
  to where it is resolved.
- AC-16 (FR-12): WHILE a user has no item that needs action, THE system SHALL hide "Do these
  first".
- AC-17 (FR-13): WHEN group members owe the user 30,000.00 ARS and the user owes 50.00 USD, THE
  system SHALL show "owed to you: 30,000.00 ARS" and "you owe: 50.00 USD".
- AC-18 (FR-14): WHEN Restaurants is 32% of October spending and 40% above its average of July to
  September, THE system SHALL show an insight stating both numbers.
- AC-19 (FR-14): IF the user has fewer than 3 previous months of expenses, THEN THE system SHALL
  show the insight without the comparison against the average.
- AC-20 (FR-15): WHEN a user requests expenses by category from 2025-01-01 to 2026-09-30, THE
  system SHALL return the totals per category for that range.
- AC-21 (FR-15): IF a user requests a range longer than 24 months, THEN THE system SHALL reject it
  and state the limit.
- AC-22 (FR-16): WHEN a user opens the income and expenses report, THE system SHALL show one income
  bar and one expense bar per month for the last 12 months.
- AC-23 (FR-17): WHEN a user requests net worth from 2025-10-01 to 2026-09-30, THE system SHALL
  return one value per month end in that range.
- AC-24 (FR-18): WHEN a user filters the category report by the tag "vacations2026", THE system
  SHALL include only movements with that tag.
- AC-25 (FR-19): WHEN a 20.00 USD expense with a frozen rate of 1,400.0000 appears in a report in
  ARS, THE system SHALL count it as 28,000.00 ARS even if today's rate is different.
- AC-26 (FR-20): WHEN the net worth point for 2026-06-30 is computed, THE system SHALL convert it
  with the latest rate stored on or before 2026-06-30.
- AC-27 (FR-21): WHILE a user has no accounts or no movements, THE system SHALL show the
  first-steps guide instead of charts.
- AC-28 (FR-22): IF a report request includes an account or tag owned by another user, THEN THE
  system SHALL answer 404 Not Found.
- AC-29 (FR-22): WHEN a user belongs to a group, THE system SHALL include in their reports only
  their own shares of the group's expenses.
- AC-30 (FR-23): WHEN a user chooses dark theme, THE system SHALL render every screen in dark
  theme and keep the choice after signing out and in again.
- AC-31 (FR-23): WHILE a user keeps the default theme setting, THE system SHALL follow the
  operating system's light or dark setting.

## Out of Scope
- Exporting reports to CSV or PDF.
- Group-level reports (spending of the whole group).
- Forecasts and projections of future balances.
- User-customizable dashboards (moving, adding or hiding widgets).
- AI-generated insights; the insight of FR-14 is a fixed rule.
- Viewing the dashboard or reports without connectivity (PRD 04 covers only movements).
- Report periods other than months (weeks, years, custom buckets).

## Risks and Mitigations
- **Numbers disagree between screens** → one conversion rule for flows (frozen rate, FR-19) shared
  with budgets (PRD 06), and one for current stocks (today's rate, FR-02).
- **Historical net worth is expensive to compute** → monthly points only (FR-08, FR-17), daily
  portfolio snapshots from PRD 07, and a response budget (NFR-01, NFR-02); PLAN decides on
  precomputed month-end snapshots.
- **Net worth looks wrong because investment prices are stale** → investment prices show their
  date (PRD 07, FR-18).
- **The reference style hurts usability on phones** (dense desktop layouts) → mobile-first
  breakpoints and bottom navigation under 1024 px (NFR-04), LCP budget (NFR-03).
- **Color-only meaning excludes color-blind users** → text or sign on every chip and pill
  (NFR-06).

## Dependencies
- PRD 01 (Identity & Access) — display currency, default rate type and time zone (FR-02, FR-20,
  FR-23) and access control (FR-22).
- PRD 02 (Accounts & Categories) — account balances and categories (FR-01, FR-09).
- PRD 03 (Movements & Exchange Rates) — movements, frozen rates and stored rates (FR-04, FR-05,
  FR-19, FR-20).
- PRD 04 (Offline Entry & Sync) — conflicts and failed syncs (FR-12).
- PRD 05 (Groups & Expense Splitting) — shares, receivables and debts (FR-01, FR-04, FR-13).
- PRD 06 (Savings Goals & Budgets) — budget status (FR-10).
- PRD 07 (Investments) — holding values and daily portfolio snapshots (FR-01, FR-17).
- PRD 08 (Recurring Payments & Reminders) — upcoming and pending occurrences (FR-11, FR-12).
- PRD 10 (Credit Cards: Statements & Installments) — installments, statements and due dates
  (FR-01, FR-04, FR-11, FR-12).

## Decision Log
- 2026-09-25: Dashboard and reports design approved by the user (net worth, month KPIs, category
  breakdown, budgets at risk, next 7 days, group balances; three reports; frozen rate for flows,
  today's rate for current net worth; exports, group reports, forecasts and custom dashboards out
  of scope).
- 2026-09-25: Visual direction from the user's two references (see Design Reference).
- 2026-09-25: User approved: light and dark themes following the system by default, sidebar from
  1024 px and bottom navigation below, rule-based insight (no AI), WCAG AA contrast with text or
  sign on every colored chip, month-to-date comparison against the same period of the previous
  month.
