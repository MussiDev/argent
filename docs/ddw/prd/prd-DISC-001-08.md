# PRD DISC-001-08: Recurring Payments & Reminders

| Field | Value |
|-------|-------|
| Ticket | DISC-001 |
| Tracker | none |
| Date | 2026-09-25 |
| PRD loops | 2 |
| Loops since last human decision | 0 |

## Context and Problem
A large part of monthly spending repeats: rent, utilities, internet, subscriptions, insurance.
Recording them by hand every month is tedious and easy to forget, and missing a due date costs a
late fee. Some of these payments have a fixed amount and are debited automatically (a streaming
subscription); others vary every month (electricity) or are paid by hand. Users of the finance
PWA (see `docs/ddw/discovery/concept-DISC-001.md`) need the app to handle both, and to remind
them before each due date.

## Goals
- Define recurring payments once and let the app handle each occurrence.
- Per payment, choose between automatic recording (fixed amounts, direct debit) and recording
  on confirmation (variable amounts) (decision 2026-09-25).
- Remind users before due dates through push notifications and in-app notices (decision
  2026-09-25: no email channel).
- Show what is coming in the next 30 days.

## Functional Requirements
- FR-01: The system must allow a user to create a recurring payment with a name, an amount, one
  of their accounts, an expense category, a frequency, a start date, an optional end date and a
  mode (automatic or confirmation).
- FR-02: The system must offer exactly these frequencies: weekly (on a weekday), monthly (on a
  day of the month) and yearly (on a date).
- FR-03: The system must schedule a monthly occurrence whose day does not exist in a month (for
  example the 31st) on the last day of that month.
- FR-04: The system must record the expense of an occurrence of an automatic recurring payment
  on its due date, with the payment's amount, account and category (PRD 03).
- FR-05: The system must create a pending occurrence on the due date of a recurring payment in
  confirmation mode, without recording any expense.
- FR-06: The system must allow a user to confirm a pending occurrence, with the amount and date
  prefilled and editable, and must then record the expense (PRD 03).
- FR-07: The system must allow a user to skip a pending occurrence without recording any expense.
- FR-08: The system must list pending occurrences whose due date has passed as overdue until they
  are confirmed or skipped.
- FR-09: The system must allow a user to set, per recurring payment, how many days before the due
  date to be reminded, from 0 to 30, with a default of 3.
- FR-10: The system must send a reminder of each occurrence the configured number of days before
  its due date.
- FR-11: The system must notify the user when an occurrence of an automatic recurring payment has
  been recorded.
- FR-12: The system must deliver every reminder and notification as an in-app notice.
- FR-13: The system must also deliver every reminder and notification as a push notification to
  each device where the user enabled push notifications.
- FR-14: The system must ask for push notification permission only when the user taps an
  "Enable notifications" control.
- FR-15: The system must tell users on iPhone or iPad that push notifications require adding the
  app to the Home Screen, when push is not available on their device.
- FR-16: The system must not include amounts or account names in the text of push notifications.
- FR-17: The system must list the occurrences of the user's recurring payments due in the next 30
  days, ordered by due date.
- FR-18: The system must allow a user to edit a recurring payment, with effect on occurrences not
  yet recorded, confirmed or skipped.
- FR-19: The system must allow a user to pause a recurring payment.
- FR-20: The system must allow a user to delete a recurring payment, removing its future
  occurrences and keeping the expenses already recorded.
- FR-21: The system must compute due dates and send reminders in the user's time zone (PRD 01,
  FR-24).
- FR-22: The system must let a user read, edit and delete only their own recurring payments and
  occurrences.
- FR-23: The system must allow a user to resume a paused recurring payment.

## Non-Functional Requirements
- NFR-01: Amounts must be stored as 64-bit integers in minor units, with 0 floating-point columns
  or fields for money (concept decision).
- NFR-02: The expense of an automatic occurrence must be recorded between 06:00 and 06:15 of its
  due date, in the user's time zone.
- NFR-03: Reminders must be handed to the push service between 09:00 and 09:15 of their day
  in the user's time zone.
- NFR-04: The scheduling job must be idempotent: running it any number of times for the same day
  must produce 0 duplicate expenses, occurrences or reminders.
- NFR-05: The upcoming payments list must answer in < 300 ms at p95 for a user with 100 recurring
  payments, measured server-side.
- NFR-06: The scheduling job must process 10,000 recurring payments in < 60 s, so it keeps
  working as users grow (concept decision: design for scalability).

## Acceptance Criteria
- AC-01 (FR-01): WHEN a user creates a recurring payment "Rent", 350,000.00 ARS, monthly on day 5,
  automatic, THE system SHALL store it and show its next occurrence.
- AC-02 (FR-01): IF a user creates a recurring payment with an amount of 0 or less, or with an end
  date before its start date, THEN THE system SHALL reject it.
- AC-03 (FR-02): WHEN a user opens the frequency selector, THE system SHALL offer exactly weekly,
  monthly and yearly.
- AC-04 (FR-03): WHEN a monthly recurring payment is set for day 31, THE system SHALL schedule its
  February 2027 occurrence on 2027-02-28.
- AC-05 (FR-04): WHEN the due date of an occurrence of an automatic recurring payment arrives, THE
  system SHALL record an expense with the payment's amount, account and category dated that day.
- AC-06 (FR-04): IF the account of an automatic recurring payment is archived on the due date,
  THEN THE system SHALL not record the expense, SHALL mark the occurrence as pending and SHALL
  notify the user.
- AC-07 (FR-05): WHEN the due date of an occurrence in confirmation mode arrives, THE system SHALL
  create a pending occurrence and SHALL not change any account balance.
- AC-08 (FR-06): WHEN a user confirms a pending occurrence after changing the amount from
  45,000.00 to 48,250.00 ARS, THE system SHALL record an expense of 48,250.00 ARS and mark the
  occurrence as confirmed.
- AC-09 (FR-07): WHEN a user skips a pending occurrence, THE system SHALL mark it as skipped and
  record no expense.
- AC-10 (FR-08): WHILE a pending occurrence is past its due date and not confirmed or skipped, THE
  system SHALL show it as overdue.
- AC-11 (FR-09): WHEN a user creates a recurring payment without setting reminder days, THE system
  SHALL set 3 days.
- AC-12 (FR-09): IF a user sets reminder days outside 0 to 30, THEN THE system SHALL reject it.
- AC-13 (FR-10): WHEN a payment due on 2026-10-10 has 3 reminder days, THE system SHALL send its
  reminder on 2026-10-07.
- AC-14 (FR-11): WHEN the expense of an automatic occurrence is recorded, THE system SHALL notify
  the user that it was recorded.
- AC-15 (FR-12): WHEN a reminder or notification is sent, THE system SHALL show it in the user's
  in-app notices.
- AC-16 (FR-13): WHEN a reminder is sent to a user who enabled push notifications on two devices,
  THE system SHALL send a push notification to both devices.
- AC-17 (FR-13): IF the push service rejects a device subscription as expired, THEN THE system
  SHALL remove that subscription and keep the in-app notice.
- AC-18 (FR-14): WHEN a user taps "Enable notifications", THE system SHALL ask the browser for
  push permission.
- AC-19 (FR-14): WHILE the user has not tapped "Enable notifications", THE system SHALL not ask
  for push permission.
- AC-20 (FR-15): WHEN a user on iPhone or iPad without the app on the Home Screen taps "Enable
  notifications", THE system SHALL explain that push notifications require adding the app to the
  Home Screen.
- AC-21 (FR-16): WHEN a push notification is sent for "Electricity" due tomorrow, THE system SHALL
  send the text "Electricity is due tomorrow" with no amount and no account name.
- AC-22 (FR-17): WHEN a user opens upcoming payments, THE system SHALL list the occurrences due in
  the next 30 days ordered by due date.
- AC-23 (FR-18): WHEN a user changes the amount of a recurring payment, THE system SHALL use the
  new amount for occurrences not yet recorded, confirmed or skipped, and leave recorded expenses
  unchanged.
- AC-24 (FR-19): WHILE a recurring payment is paused, THE system SHALL create no occurrences and
  send no reminders for it.
- AC-25 (FR-23): WHEN a user resumes a paused recurring payment, THE system SHALL schedule its
  next occurrence from the resume date onward.
- AC-26 (FR-20): WHEN a user deletes a recurring payment, THE system SHALL remove its future and
  pending occurrences and keep the expenses already recorded.
- AC-27 (FR-21): WHEN an automatic occurrence is due on 2026-10-05 for a user whose time zone is
  `Europe/Madrid`, THE system SHALL record it between 06:00 and 06:15 of 2026-10-05 Madrid time,
  regardless of the server's time zone.
- AC-30 (FR-21): WHEN a user changes their time zone, THE system SHALL compute the due dates and
  reminder times of occurrences not yet processed in the new time zone.
- AC-28 (FR-22): IF a user requests to read, edit or delete a recurring payment owned by another
  user, THEN THE system SHALL answer 404 Not Found and leave it unchanged.
- AC-29 (FR-22): WHEN a user opens upcoming payments, THE system SHALL show only their own
  occurrences.

## Out of Scope
- Email or SMS reminders (decision 2026-09-25: push and in-app only).
- Recurring incomes (salary) and recurring transfers.
- Recurring group expenses.
- Frequencies other than weekly, monthly and yearly (every N months, business days).
- Detecting recurring payments automatically from past movements.
- Paying bills from the app.
- Credit card statement due reminders (PRD 10 decides whether statements create reminders).
- Push notifications for budget alerts (PRD 06 keeps them in-app).

## Risks and Mitigations
- **iPhone users who do not install the app miss push reminders** → in-app notices always
  (FR-12) and a clear explanation of the Home Screen requirement (FR-15); accepted by decision
  (no email).
- **An automatic expense is recorded for a payment that did not happen** → automatic mode is
  meant for fixed amounts and direct debits; the user can edit or delete the expense (PRD 03)
  and is notified when it is recorded (FR-11).
- **Financial data on the lock screen** → push text has no amounts or account names (FR-16).
- **Duplicated expenses if the job runs twice** → idempotent scheduling (NFR-04).
- **Push service endpoints expire silently** → expired subscriptions are removed (AC-17).

## Dependencies
- Web Push API and a push service with VAPID keys; on iOS/iPadOS, push requires 16.4+ and the app
  added to the Home Screen — FR-13, FR-14, FR-15.
- PRD 01 (Identity & Access) — ownership and access control (FR-22), user time zone (FR-21).
- PRD 02 (Accounts & Categories) — accounts and categories of recurring payments (FR-01, AC-06).
- PRD 03 (Movements & Exchange Rates) — recording expenses and their exchange rate (FR-04,
  FR-06).
- PRD 10 (Credit Cards: Statements & Installments) — statement due dates (Out of Scope).

## Decision Log
- 2026-09-25: Recurring payments configurable per payment: automatic or confirmation.
- 2026-09-25: Reminder channels: push and in-app; no email.
- 2026-09-25: User decision: per-user time zone, mandatory. Dates and scheduled times are
  computed in the user's time zone (PRD 01, FR-24).
- 2026-09-25: User approved: weekly/monthly/yearly frequencies, payments only (no recurring
  incomes or group expenses), 3 reminder days by default (0–30), no amounts or account names in
  push text, archived account leaves automatic occurrence pending with a notice, overdue pending
  occurrences.
