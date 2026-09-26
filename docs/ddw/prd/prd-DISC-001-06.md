# PRD DISC-001-06: Savings Goals & Budgets

| Field | Value |
|-------|-------|
| Ticket | DISC-001 |
| Tracker | none |
| Date | 2026-09-25 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Recording movements (PRD 03) tells users where their money went; it does not tell them whether
they are on track. Users of the finance PWA (see `docs/ddw/discovery/concept-DISC-001.md`) want
to save for concrete things ("Vacations: USD 2,000 by December") and to cap their spending per
category ("at most ARS 150,000 a month on outings"), and to be warned before they overspend.
Some users keep a separate account per goal; others keep everything in one account and set money
aside mentally.

## Goals
- Let users define savings goals and see their progress and the monthly contribution needed.
- Support both goal styles: linked to an account, or tracked with manual contributions
  (decision 2026-09-25).
- Let users set monthly spending budgets over one or more categories, in ARS or USD, with alerts
  and optional rollover (decision 2026-09-25, based on Monarch, YNAB, Wallet and Spendee).
- Count only the user's real share of group expenses (PRD 05).

## Functional Requirements
- FR-01: The system must allow a user to create a savings goal with a name, a target amount, a
  currency (ARS or USD) and an optional target date.
- FR-02: The system must allow a user to link a goal to one of their accounts with the same
  currency when creating it.
- FR-03: The system must compute the progress of a linked goal as the current balance of the
  linked account.
- FR-04: The system must allow a user to record contributions to a goal that is not linked to an
  account.
- FR-05: The system must allow a user to record withdrawals from a goal that is not linked to an
  account.
- FR-06: The system must compute the progress of a goal that is not linked to an account as the
  sum of its contributions minus the sum of its withdrawals.
- FR-07: The system must show for each goal its progress amount and its percentage of the target.
- FR-08: The system must show for each goal with a target date the monthly amount needed to reach
  the target, computed as the remaining amount divided by the number of months left, including
  the current month, rounded up to the minor unit.
- FR-09: The system must mark a goal as reached when its progress is greater than or equal to its
  target amount.
- FR-10: The system must allow a user to edit the name, target amount and target date of a goal.
- FR-11: The system must allow a user to delete a goal.
- FR-12: The system must allow a user to create a monthly budget with a name, an amount, a
  currency (ARS or USD) and one or more expense categories.
- FR-13: The system must include the subcategories of every parent category selected in a
  budget.
- FR-14: The system must compute the spending of a budget in a month as the sum of the user's
  personal expenses and group expense shares (PRD 05) in its categories during that month.
- FR-15: The system must convert to the budget currency every expense or share in the other
  currency, using the rate frozen on that movement (PRD 03).
- FR-16: The system must count a group expense share toward a budget when the name of the group
  category matches, case-insensitively, the name of a category selected in the budget.
- FR-17: The system must show for each budget in the current month its amount, its spending, its
  remaining amount and its percentage used.
- FR-18: The system must allow a user to turn rollover on or off for each budget.
- FR-19: The system must add to a budget with rollover on, at the start of each month, the
  remaining amount of the previous month when that remaining amount is greater than 0.
- FR-20: The system must allow a user to set, per budget, the alert thresholds as percentages of
  the available amount, with defaults of 80% and 100%.
- FR-21: The system must show an in-app alert the first time in a month that a budget's spending
  crosses each of its thresholds.
- FR-22: The system must allow a user to edit the name, amount, categories, thresholds and
  rollover setting of a budget, with effect from the current month.
- FR-23: The system must allow a user to delete a budget.
- FR-24: The system must let a user read, edit and delete only their own goals and budgets.

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units, with 0 floating-point columns
  or fields for money (concept decision).
- NFR-02: The budgets screen must answer in < 500 ms at p95 for a user with 50 budgets and
  100,000 movements, measured server-side.
- NFR-03: An in-app alert must appear within 5 s of saving the movement that crosses the
  threshold, while the app is open and online.
- NFR-04: A user must be able to hold at least 50 goals and 50 budgets.
- NFR-05: Alert thresholds must be integers between 1 and 200 (percent), with at most 5
  thresholds per budget.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user creates a goal "Vacations" with a target of 2,000.00 USD and a
  target date of 2026-12-31, THE system SHALL store it and show it in the goal list.
- AC-02 (FR-01): IF a user creates a goal with a target amount of 0 or less, THEN THE system
  SHALL reject it.
- AC-03 (FR-02): IF a user links a goal to an account with a different currency, THEN THE system
  SHALL reject it.
- AC-04 (FR-03): WHEN the balance of the account linked to a goal changes from 500.00 to 700.00
  USD, THE system SHALL show a progress of 700.00 USD for that goal.
- AC-05 (FR-04): WHEN a user records a contribution of 200.00 USD to a goal not linked to an
  account, THE system SHALL increase its progress by 200.00 USD and SHALL not change any account
  balance.
- AC-06 (FR-05): WHEN a user records a withdrawal of 50.00 USD from a goal not linked to an
  account with a progress of 200.00 USD, THE system SHALL show a progress of 150.00 USD.
- AC-07 (FR-05): IF a user records a withdrawal larger than the goal's current progress, THEN THE
  system SHALL reject it.
- AC-08 (FR-06): WHEN a goal not linked to an account has contributions of 300.00 and 200.00 USD
  and a withdrawal of 100.00 USD, THE system SHALL show a progress of 400.00 USD.
- AC-09 (FR-07): WHEN a goal with a target of 2,000.00 USD has a progress of 500.00 USD, THE
  system SHALL show 500.00 USD and 25%.
- AC-10 (FR-08): WHEN on 2026-10-15 a goal has 1,500.00 USD remaining and a target date of
  2026-12-31, THE system SHALL show a monthly amount needed of 500.00 USD (3 months: October,
  November, December).
- AC-11 (FR-08): IF the target date of a goal has passed and the goal is not reached, THEN THE
  system SHALL show it as overdue instead of a monthly amount.
- AC-12 (FR-09): WHEN a goal's progress reaches or exceeds its target amount, THE system SHALL
  show it as reached.
- AC-13 (FR-10): WHEN a user saves a new name, target amount or target date for a goal, THE
  system SHALL persist it and recompute its percentage and monthly amount needed.
- AC-14 (FR-11): WHEN a user deletes a goal, THE system SHALL remove it and its contributions and
  withdrawals, and SHALL not change any account balance.
- AC-15 (FR-12): WHEN a user creates a budget "Outings" of 150,000.00 ARS over the categories
  Entertainment and Restaurants, THE system SHALL store it and show it in the budget list.
- AC-16 (FR-12): IF a user creates a budget with no category or with an amount of 0 or less, THEN
  THE system SHALL reject it.
- AC-17 (FR-13): WHEN a budget includes the parent category Food, THE system SHALL count the
  expenses of Groceries, Restaurants and Delivery in it.
- AC-18 (FR-14): WHEN in October a user has personal expenses of 50,000.00 ARS and a group share
  of 10,000.00 ARS in a budget's categories, THE system SHALL show an October spending of
  60,000.00 ARS for that budget.
- AC-19 (FR-15): WHEN an expense of 20.00 USD with a frozen rate of 1,500.0000 falls into an ARS
  budget, THE system SHALL count 30,000.00 ARS.
- AC-20 (FR-16): WHEN a group share has the group category "Food" and a budget includes the
  personal category "food", THE system SHALL count that share in the budget.
- AC-21 (FR-16): IF a group share's category name matches no category in any budget, THEN THE
  system SHALL not count it in any budget.
- AC-22 (FR-17): WHEN a budget of 150,000.00 ARS has a spending of 120,000.00 ARS, THE system
  SHALL show a remaining amount of 30,000.00 ARS and 80% used.
- AC-23 (FR-18): WHEN a user turns rollover on for a budget, THE system SHALL persist the setting
  and show it on the budget.
- AC-24 (FR-19): WHEN October starts and a budget of 150,000.00 ARS with rollover on had
  20,000.00 ARS remaining in September, THE system SHALL show 170,000.00 ARS available for
  October.
- AC-25 (FR-19): WHEN October starts and a budget with rollover on overspent in September, THE
  system SHALL show only the budget amount available for October.
- AC-26 (FR-19): WHILE rollover is off for a budget, THE system SHALL show only the budget amount
  available at the start of each month.
- AC-27 (FR-20): WHEN a user creates a budget without setting thresholds, THE system SHALL set
  thresholds of 80% and 100%.
- AC-28 (FR-20): IF a user sets a threshold outside 1 to 200 or more than 5 thresholds, THEN THE
  system SHALL reject it.
- AC-29 (FR-21): WHEN a movement makes a budget's spending cross 80% for the first time in the
  month, THE system SHALL show an in-app alert naming the budget and the percentage used.
- AC-30 (FR-21): WHEN a later movement in the same month keeps the spending above 80% without
  crossing another threshold, THE system SHALL not show a new alert.
- AC-31 (FR-22): WHEN a user changes the amount of a budget in October, THE system SHALL use the
  new amount for October and later months and leave September unchanged.
- AC-32 (FR-23): WHEN a user deletes a budget, THE system SHALL remove it and SHALL not change any
  movement.
- AC-33 (FR-24): IF a user requests to read, edit or delete a goal or budget owned by another
  user, THEN THE system SHALL answer 404 Not Found and leave it unchanged.
- AC-34 (FR-24): WHEN a user opens their goals or budgets, THE system SHALL show only the ones
  they own.

## Out of Scope
- Weekly, yearly or custom budget periods (monthly only).
- Carrying overspending into the next month (only the remaining amount rolls over).
- Group or shared budgets.
- Shared or group savings goals.
- Push or email notifications (in-app only; push depends on PRD 08).
- Zero-based ("every peso has a job") and "Flex" budgeting methodologies.
- Automatic contributions to goals (e.g. "set aside 10% of every income").
- Moving money between budget categories.
- Budgets over income categories.

## Risks and Mitigations
- **Group shares in budgets depend on category names matching** → group categories start with the
  same names as the default personal categories (PRD 05, FR-28), so matches work by default;
  unmatched shares are simply not counted (AC-21) instead of being guessed.
- **A linked goal's progress falls when the user spends from that account** → expected: the goal
  reflects the real balance; users who want isolation use manual contributions.
- **Converted amounts drift from what the user expects** → conversion always uses each movement's
  frozen rate (FR-15), never today's rate.
- **Alert spam** → each threshold alerts once per month (FR-21, AC-30).

## Dependencies
- PRD 01 (Identity & Access) — ownership and access control (FR-24).
- PRD 02 (Accounts & Categories) — accounts linked to goals and categories selected in budgets
  (FR-02, FR-03, FR-12, FR-13).
- PRD 03 (Movements & Exchange Rates) — personal expenses and frozen rates (FR-14, FR-15).
- PRD 05 (Groups & Expense Splitting) — group expense shares and group categories (FR-14, FR-16).
- PRD 08 (Recurring Payments & Reminders) — push notifications (Out of Scope).

## Decision Log
- 2026-09-25: Savings = balances (accounts) + goals + category budgets with alerts (concept).
- 2026-09-25: Goals can be linked to an account or tracked with manual contributions.
- 2026-09-25: Budget design after reviewing Monarch, YNAB, Wallet and Spendee: monthly period,
  one or more categories per budget, ARS or USD, only the user's share of group expenses,
  configurable alerts (80% and 100% by default), optional rollover of the remaining amount only,
  no group budgets, no Flex or zero-based methodologies.
- 2026-09-25: User approved, including group shares counted in budgets by case-insensitive
  category name match, monthly amount counting the current month, no withdrawal beyond
  progress, edits effective from the current month, up to 5 thresholds (1–200%).
