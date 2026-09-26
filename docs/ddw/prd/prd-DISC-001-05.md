# PRD DISC-001-05: Groups & Expense Splitting

| Field | Value |
|-------|-------|
| Ticket | DISC-001 |
| Tracker | none |
| Date | 2026-09-25 |
| PRD loops | 2 |
| Loops since last human decision | 0 |

## Context and Problem
Users of the finance PWA (see `docs/ddw/discovery/concept-DISC-001.md`) share expenses in two
ways: households, where each member pays and costs are split (equally or in proportion to
income) and settled periodically, and ad-hoc groups such as trips or roommates. In both cases
people need to know who owes whom, in ARS and in USD, without their personal reports counting
money they only lent as money they spent. Some group members will never install the app.

## Goals
- One "group" concept covering households and ad-hoc groups (concept decision).
- Split each expense equally, by percentages or by exact amounts.
- Keep balances per currency, and allow consolidating them into one currency when settling.
- Reflect in each member's personal finances only their real share of each expense.
- Let groups include people without an account, who can claim their place later.
- Protect shared money: only the creator of an expense or an admin changes it, and every change
  is visible to all members.

## Functional Requirements
- FR-01: The system must allow a user to create a group with a name and a default rate type, and
  must make the creator an admin of that group.
- FR-02: The system must allow an admin to set a default split for the group (equal, or a
  percentage per member) that is prefilled on every new group expense.
- FR-03: The system must allow any member to generate an invitation link to the group that
  expires 7 days after it is generated.
- FR-04: The system must add a registered user as a member of the group when they open a valid
  invitation link and accept it.
- FR-05: The system must allow any member to add a ghost member to the group with only a display
  name.
- FR-06: The system must allow any member to generate a claim link for a ghost member.
- FR-07: The system must replace a ghost member with a registered user who opens and accepts a
  valid claim link, and must transfer to that user every expense, share and settlement of the
  ghost member.
- FR-08: The system must allow an admin to make another registered member an admin.
- FR-09: The system must allow an admin to remove a member whose balance is 0 in every currency.
- FR-10: The system must allow a member whose balance is 0 in every currency to leave the group.
- FR-11: The system must allow a member to record a group expense with an amount greater than 0,
  a currency (ARS or USD), a date, a payer (any member, including ghost members), a group
  category, a description and a split among members.
- FR-12: The system must split an expense in equal parts among the selected members.
- FR-13: The system must split an expense by percentages per member that add up to exactly 100%.
- FR-14: The system must split an expense by exact amounts per member that add up to exactly the
  expense amount.
- FR-15: The system must assign the minor units left over by an equal or percentage split one by
  one to the members in the split, starting with the payer and then in order of joining the
  group.
- FR-16: The system must require a registered payer who records their own payment to choose one
  of their accounts in the expense currency, and must record the full amount as leaving that
  account (PRD 03).
- FR-17: The system must count the payer's own share as a personal expense and the rest of the
  amount as a receivable, not as a personal expense.
- FR-18: The system must count each non-payer registered member's share as a personal expense
  of that member, with no movement in any of their accounts.
- FR-19: The system must show the balance of each member per currency (ARS and USD separately).
- FR-20: The system must show a simplified list of payments per currency that settles all
  balances with the minimum number of transfers.
- FR-21: The system must allow a member to record a settlement payment from one member to another
  in one currency.
- FR-22: The system must record a settlement paid or received by a registered member, when they
  choose one of their accounts, as a transfer out of or into that account that is neither an
  expense nor an income.
- FR-23: The system must allow two members to settle all their balances in a single currency,
  converting the other currency with the current rate of the group's default rate type.
- FR-24: The system must allow the members settling to replace the conversion rate of a
  consolidated settlement with a manual rate before recording it.
- FR-25: The system must allow only the member who recorded a group expense or settlement, or an
  admin, to edit or delete it.
- FR-26: The system must record in a group activity log every creation, edit and deletion of
  group expenses and settlements, with the member who did it and the date and time.
- FR-27: The system must show the group activity log to every member of the group.
- FR-28: The system must create for every new group the expense categories listed in Appendix A
  of PRD 02 (top level only).
- FR-29: The system must allow an admin to change the group's default rate type.
- FR-30: The system must allow only members of a group to read or change any data of that group.
- FR-31: The system must replace a member who deletes their account with a ghost member named
  "Former member", keeping all of their group expenses, shares and settlements.
- FR-32: The system must allow only admins to add, rename and archive group categories.

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units, with 0 floating-point columns
  or fields for money (concept decision).
- NFR-02: For every group and every currency, the sum of all member balances must be exactly 0
  after every operation, verified by an automated test over 10,000 random operations.
- NFR-03: The balance view of a group with 50 members and 10,000 expenses must answer in
  < 500 ms at p95, measured server-side.
- NFR-04: A group must have at most 50 members, ghost members included.
- NFR-05: Invitation and claim link tokens must carry at least 128 bits of randomness and be
  single-use for claim links.
- NFR-06: 100% of changes to group expenses and settlements must appear in the activity log, and
  log entries must never be edited or deleted while the group exists.

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user creates a group with a name and a default rate type, THE system
  SHALL create it and make that user its first admin.
- AC-02 (FR-02): WHEN an admin sets a default split of 60% / 40% for two members, THE system
  SHALL prefill that split on every new expense of the group.
- AC-03 (FR-03): WHEN a member generates an invitation link, THE system SHALL return a link that
  expires 7 days later.
- AC-04 (FR-04): WHEN a registered user opens a valid invitation link and accepts it, THE system
  SHALL add them as a member of the group.
- AC-05 (FR-04): IF a user opens an expired invitation link, THEN THE system SHALL reject it and
  add no member.
- AC-06 (FR-05): WHEN a member adds a ghost member named "Pedro", THE system SHALL add a member
  "Pedro" with no account who can be payer and part of splits.
- AC-07 (FR-06): WHEN a member generates a claim link for a ghost member, THE system SHALL return
  a single-use link bound to that ghost member.
- AC-08 (FR-07): WHEN a registered user opens a valid claim link and accepts it, THE system SHALL
  replace the ghost member with that user and show that user every expense, share and settlement
  previously assigned to the ghost member.
- AC-09 (FR-07): IF a user opens a claim link that was already used, THEN THE system SHALL reject
  it.
- AC-10 (FR-08): WHEN an admin makes a registered member an admin, THE system SHALL grant that
  member admin permissions in the group.
- AC-11 (FR-09): WHEN an admin removes a member whose balance is 0 in ARS and in USD, THE system
  SHALL remove that member from the group.
- AC-12 (FR-09): IF an admin tries to remove a member with a balance other than 0 in any
  currency, THEN THE system SHALL reject it and show the pending balance.
- AC-13 (FR-10): WHEN a member with a balance of 0 in every currency leaves the group, THE system
  SHALL remove them from the group.
- AC-14 (FR-10): IF a member with a balance other than 0 in any currency tries to leave, THEN THE
  system SHALL reject it and show the pending balance.
- AC-15 (FR-11): WHEN a member records a group expense with all required fields and a valid
  split, THE system SHALL store it and update the balances of the group.
- AC-16 (FR-11): IF a member records a group expense with an amount of 0 or less, THEN THE system
  SHALL reject it.
- AC-17 (FR-12): WHEN an expense of 40,000.00 ARS is split equally among 4 members, THE system
  SHALL assign 10,000.00 ARS to each.
- AC-18 (FR-13): IF a member submits a percentage split that does not add up to exactly 100%,
  THEN THE system SHALL reject it and show the current total.
- AC-19 (FR-13): WHEN an expense of 100,000.00 ARS is split 60% / 40%, THE system SHALL assign
  60,000.00 ARS and 40,000.00 ARS.
- AC-20 (FR-14): IF a member submits an exact-amount split that does not add up to the expense
  amount, THEN THE system SHALL reject it and show the difference.
- AC-21 (FR-15): WHEN an expense of 100.00 ARS is split equally among 3 members with the payer
  first, THE system SHALL assign 33.34 ARS to the payer and 33.33 ARS to each of the other two.
- AC-22 (FR-16): WHEN a registered member records an expense of 40,000.00 ARS that they paid from
  one of their ARS accounts, THE system SHALL subtract 40,000.00 ARS from that account.
- AC-23 (FR-16): IF a registered payer recording their own payment chooses an account whose
  currency differs from the expense currency, THEN THE system SHALL reject it.
- AC-24 (FR-17): WHEN a registered member pays 40,000.00 ARS split equally among 4, THE system
  SHALL count 10,000.00 ARS as that member's personal expense and 30,000.00 ARS as a receivable.
- AC-25 (FR-18): WHEN another member pays an expense and a registered member's share is
  10,000.00 ARS, THE system SHALL count 10,000.00 ARS as that member's personal expense and
  SHALL not change any of their account balances.
- AC-26 (FR-19): WHEN a member opens the group balances, THE system SHALL show each member's
  balance in ARS and in USD separately.
- AC-27 (FR-20): WHEN A owes B 100.00 ARS and B owes C 100.00 ARS, THE system SHALL show one
  simplified payment of 100.00 ARS from A to C.
- AC-28 (FR-21): WHEN a member records a settlement of 30,000.00 ARS from A to B, THE system
  SHALL reduce what A owes B in ARS by 30,000.00.
- AC-29 (FR-22): WHEN a registered member records a settlement they received into one of their
  accounts, THE system SHALL add the amount to that account and SHALL not count it as an income.
- AC-30 (FR-23): WHEN A owes B 100.00 USD and B owes A 50,000.00 ARS and they settle in USD at a
  group rate of 1,000.0000 ARS per USD, THE system SHALL record one settlement of 50.00 USD from
  A to B and leave both balances at 0.
- AC-31 (FR-24): WHEN the members replace the conversion rate of a consolidated settlement with a
  manual rate greater than 0, THE system SHALL use that rate and store it with source "manual".
- AC-32 (FR-25): WHEN the member who recorded a group expense, or an admin, edits or deletes it,
  THE system SHALL apply the change and update the balances.
- AC-33 (FR-25): IF a member who is neither the one who recorded a group expense nor an admin
  tries to edit or delete it, THEN THE system SHALL reject it and leave the expense unchanged.
- AC-34 (FR-26): WHEN a group expense or settlement is created, edited or deleted, THE system
  SHALL add a log entry with the action, the member and the date and time, including the values
  before and after for edits.
- AC-35 (FR-27): WHEN any member opens the group activity log, THE system SHALL show all its
  entries, newest first.
- AC-36 (FR-28): WHEN a group is created, THE system SHALL create for it the top-level expense
  categories of PRD 02 Appendix A.
- AC-37 (FR-32): IF a member who is not an admin tries to add, rename or archive a group
  category, THEN THE system SHALL reject it.
- AC-38 (FR-29): WHEN an admin changes the group's default rate type, THE system SHALL prefill
  the new type's rate on the next consolidated settlement and leave existing records unchanged.
- AC-39 (FR-30): IF a user who is not a member of a group requests any of its data, THEN THE
  system SHALL answer 404 Not Found.
- AC-40 (FR-30): WHEN a user opens their group list, THE system SHALL show only groups they are a
  member of.
- AC-41 (FR-31): WHEN a member deletes their account, THE system SHALL show a ghost member
  "Former member" in their place, with the same expenses, shares, settlements and balances.
- AC-42 (FR-32): WHEN an admin adds, renames or archives a group category, THE system SHALL apply
  the change and offer the updated list on the next group expense.

## Out of Scope
- Splitting by shares/weights ("2 parts for Juan") — equivalent results via percentages or exact
  amounts.
- Several payers for one expense.
- Joint accounts or a shared pot (decision: households split, they do not pool money).
- Payments between members through the app (Mercado Pago, bank transfers); settlements are only
  recorded.
- Recurring group expenses (PRD 08 covers personal recurring payments).
- Comments, reactions or chat on expenses.
- Receipt photos.
- Email or push notifications of group activity (PRD 08 covers reminders).
- Converting existing balances automatically when the default rate type changes.
- Groups with more than 50 members.

## Risks and Mitigations
- **Someone records expenses in the name of a ghost member who never sees them** → accepted by
  decision; the activity log (FR-26) shows who recorded what, and claiming (FR-07) exposes the
  full history to the real person.
- **Disputes over the conversion rate when consolidating** → balances stay per currency until
  settlement (FR-19); consolidation is opt-in with an editable rate (FR-23, FR-24).
- **Rounding makes the group not add up** → deterministic leftover rule (FR-15) and the zero-sum
  invariant (NFR-02).
- **An admin abuses edit rights** → every change is logged with before/after values and visible
  to all (FR-26, FR-27, AC-34).
- **Concurrent offline edits on group expenses** → explicit conflicts per PRD 04.
- **Double counting in personal reports** → only the member's share is an expense; receivables
  and settlements are neither expense nor income (FR-17, FR-18, FR-22).

## Dependencies
- PRD 01 (Identity & Access) — registered users, account deletion (FR-04, FR-07, FR-31) and
  access control (FR-30).
- PRD 02 (Accounts & Categories) — accounts and the default category list (FR-16, FR-22, FR-28, FR-32).
- PRD 03 (Movements & Exchange Rates) — account movements, stored rates and rate types (FR-16,
  FR-22, FR-23, FR-29).
- PRD 04 (Offline Entry & Sync) — conflict handling for group expenses edited offline.
- PRD 09 (Dashboard & Reports) — how personal shares and receivables appear in reports (FR-17,
  FR-18).

## Decision Log
- 2026-09-25: Households are permanent groups; no shared pot (concept).
- 2026-09-25: Split modes: equal, percentages, exact amounts.
- 2026-09-25: Balances per currency, with optional consolidation at settlement time using the
  group's rate, editable.
- 2026-09-25: Ghost members allowed, claimable by invitation.
- 2026-09-25: Payer's account drops by the total; only each member's share counts as their
  expense; the rest is a receivable; settlements are neither expense nor income.
- 2026-09-25: Only the member who recorded an expense or an admin edits/deletes it; activity log
  visible to all members.
- 2026-09-25: Leftover minor units: the user questioned rounding and asked for exact splits.
  Exact splits are impossible with a minimum currency unit; options were high internal precision
  with rounding at settlement, a rotating leftover, or leftover to the payer first. User chose
  leftover to the payer first (FR-15).
- 2026-09-25: User approved the remaining decisions: 7-day invitation links, single-use claim
  links, any member invites and adds ghosts, leaving/removal only with 0 balance, simplified
  debts view, group-level categories managed by admins, deleted accounts become "Former member",
  50 members max, one payer per expense, immutable activity log.
