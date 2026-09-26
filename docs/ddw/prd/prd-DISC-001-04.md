# PRD DISC-001-04: Offline Entry & Sync

| Field | Value |
|-------|-------|
| Ticket | DISC-001 |
| Tracker | none |
| Date | 2026-09-25 |
| PRD loops | 2 |
| Loops since last human decision | 0 |

## Context and Problem
The core use case of the finance PWA (see `docs/ddw/discovery/concept-DISC-001.md`) is writing
down an expense at the moment of paying — on the subway, on a trip, in a basement bar. If the app
needs connectivity for that, the entry is forgotten and the data stops being trustworthy. The
app must therefore accept movements without connectivity and sync them later, without duplicating
them and without silently losing anyone's changes, including changes to movements that other
group members share.

## Goals
- Record movements (PRD 03) with no connectivity, with the same form as online.
- Sync automatically when connectivity returns, with no duplicates.
- Resolve edit conflicts: last change wins for personal movements, explicit choice for group
  movements (decision 2026-09-25: mixed strategy).
- Make the sync state visible so the user always knows what is not yet on the server.

## Functional Requirements
- FR-01: The system must allow a signed-in user to record expenses, incomes, transfers and
  currency exchanges (PRD 03) while the device has no connectivity.
- FR-02: The system must assign every movement created on the device a globally unique
  identifier generated on the device.
- FR-03: The system must keep movements recorded without connectivity in a local queue that
  survives closing the app and restarting the device.
- FR-04: The system must send the queued changes to the server automatically when connectivity
  returns.
- FR-05: The system must store each change only once on the server, even when the device sends
  it more than once.
- FR-06: The system must keep on the device a copy of the user's active accounts, active
  categories, tags, default rate type and latest stored rates, to fill the entry form without
  connectivity.
- FR-07: The system must keep on the device the user's 100 most recent movements, so they can be
  viewed, edited and deleted without connectivity.
- FR-08: The system must require a manual rate on an expense or income recorded without
  connectivity when the device has no stored rate.
- FR-09: The system must show the sync state of every movement: pending, synced, conflict or
  failed.
- FR-10: The system must show the number of changes waiting to be synced.
- FR-11: The system must apply the last change received by the server when two changes to the
  same personal movement conflict.
- FR-12: The system must not apply a change to a group movement made on a version older than the
  one on the server, and must mark it as a conflict.
- FR-13: The system must show the user both versions of a group movement in conflict (theirs and
  the server's) and let them keep one of the two.
- FR-14: The system must keep the server version of a group movement in conflict until the user
  resolves the conflict.
- FR-15: The system must mark as failed a queued change that the server rejects on validation
  (for example, an archived account), and let the user edit it and retry, or discard it.
- FR-16: The system must retry sending queued changes that failed because of network or server
  errors.
- FR-17: The system must keep the local queue when the session expires while offline, and sync it
  after the same user signs in again.
- FR-18: The system must warn a user who signs out with changes pending sync.
- FR-19: The system must delete all local data of a user from the device when they confirm the
  sign out.

## Non-Functional Requirements
- NFR-01: The entry form must open in < 1 s without connectivity on a mid-range phone (reference:
  4 GB RAM, 2021 hardware).
- NFR-02: The local queue must hold at least 1,000 pending movements.
- NFR-03: Syncing 100 pending movements must finish in < 10 s on a 4G connection (reference: 10
  Mbps down, 5 Mbps up, 50 ms latency).
- NFR-04: Retries must use exponential backoff starting at 5 s and capped at 5 minutes between
  attempts.
- NFR-05: Sync must lose 0 changes and create 0 duplicates in a test that cuts connectivity at a
  random point during 1,000 sync runs.
- NFR-06: 100% of a user's local data (queue, cached entities, recent movements) must be removed
  from the device after a confirmed sign out.
- NFR-07: The app shell (HTML, JS, CSS, icons) must be cached by a service worker so the app
  starts with 0 network requests when offline.

## Acceptance Criteria
- AC-01 (FR-01): WHILE the device has no connectivity, WHEN a user saves a valid expense, THE
  system SHALL store it in the local queue and show it in the movement list as pending.
- AC-02 (FR-01): WHILE the device has no connectivity, WHEN a user saves a valid transfer or
  currency exchange, THE system SHALL store it in the local queue as pending.
- AC-03 (FR-02): WHEN a movement is created on the device, THE system SHALL assign it a UUID
  before storing it, with or without connectivity.
- AC-04 (FR-03): WHEN a user closes the app with 5 pending movements and opens it again, THE
  system SHALL still show those 5 movements as pending.
- AC-05 (FR-04): WHEN connectivity returns with pending changes, THE system SHALL start sending
  them without any user action.
- AC-06 (FR-05): IF the device sends the same change twice (for example, the connection dropped
  before the response arrived), THEN THE system SHALL store it only once on the server.
- AC-07 (FR-06): WHILE the device has no connectivity, WHEN a user opens the entry form, THE
  system SHALL offer their active accounts, active categories and tags, and prefill the rate
  with the latest stored rate of their default rate type.
- AC-08 (FR-07): WHILE the device has no connectivity, WHEN a user opens the movement list, THE
  system SHALL show their 100 most recent movements plus the pending ones.
- AC-09 (FR-07): WHILE the device has no connectivity, WHEN a user edits or deletes one of their
  cached movements, THE system SHALL apply it on the device and queue the change as pending.
- AC-10 (FR-08): IF a user records an expense or income without connectivity and the device has
  no stored rate, THEN THE system SHALL require a manual rate before saving.
- AC-11 (FR-09): WHEN a movement changes sync state, THE system SHALL show its current state:
  pending, synced, conflict or failed.
- AC-12 (FR-10): WHILE there are changes waiting to be synced, THE system SHALL show their count.
- AC-13 (FR-11): WHEN two changes to the same personal movement reach the server, THE system
  SHALL keep the one received last and mark both devices' copies as synced with that version.
- AC-14 (FR-12): IF a change to a group movement arrives based on a version older than the
  server's, THEN THE system SHALL not apply it and SHALL mark it as a conflict.
- AC-15 (FR-13): WHEN a user opens a group movement in conflict, THE system SHALL show their
  version and the server version side by side and offer "keep mine" and "keep server's".
- AC-16 (FR-13): WHEN a user chooses "keep mine" in a conflict, THE system SHALL apply their
  version on the server as a new version and mark the movement as synced.
- AC-17 (FR-14): WHILE a group movement is in conflict, THE system SHALL show the server version
  to the other group members.
- AC-18 (FR-15): IF the server rejects a queued change on validation, THEN THE system SHALL mark
  it as failed, show the reason, and offer to edit and retry or discard it.
- AC-19 (FR-16): IF sending a queued change fails because of a network or server error, THEN THE
  system SHALL keep it pending and retry it.
- AC-20 (FR-17): IF the session expires while there are pending changes, THEN THE system SHALL
  keep them and sync them after the same user signs in again.
- AC-21 (FR-17): IF a different user signs in on the device while another user's changes are
  pending, THEN THE system SHALL not send those changes under the new user.
- AC-22 (FR-18): WHEN a user with pending changes chooses to sign out, THE system SHALL warn that
  the pending changes will be lost and ask for confirmation.
- AC-23 (FR-19): WHEN a user confirms the sign out, THE system SHALL delete their queue, cached
  entities and cached movements from the device.

## Out of Scope
- Full offline browsing of history beyond the 100 most recent movements.
- Offline creation or editing of accounts, categories, groups, goals, budgets, investments and
  recurring payments (only movements work offline).
- Offline sign-in or registration.
- Automatic merging of conflicting fields (field-by-field merge).
- Conflict resolution for personal movements by user choice.
- Background sync while the app is closed (Background Sync API support varies by browser;
  sync runs when the app is open).
- Encryption of local data beyond what the browser and operating system provide.

## Risks and Mitigations
- **Silent overwrite of personal edits (last change wins)** → accepted by decision: the same person
  on two devices; conflicts are rare and low-impact.
- **Group members lose each other's changes** → explicit conflicts for group movements (FR-12 to
  FR-14).
- **Queued changes become invalid by the time they sync** (archived account, deleted category) →
  failed state with edit-and-retry (FR-15).
- **Financial data left on a shared or lost device** → local data wiped on sign out (FR-19,
  NFR-06); stronger device-level protection is out of scope.
- **Browsers evict local storage under pressure (notably iOS Safari)** → request persistent
  storage where supported, keep the queue small by syncing as soon as possible, and warn the
  user when persistent storage is denied.
- **Duplicates from retries** → client-generated UUIDs and idempotent writes (FR-02, FR-05,
  NFR-05).

## Dependencies
- PRD 01 (Identity & Access) — sessions and sign out (FR-17, FR-18, FR-19).
- PRD 02 (Accounts & Categories) — accounts and categories cached on the device (FR-06, FR-15).
- PRD 03 (Movements & Exchange Rates) — movement types, validation and stored rates (FR-01,
  FR-06, FR-08).
- PRD 05 (Groups & Expense Splitting) — which movements are group movements (FR-12 to FR-14).
- Browser platform: Service Worker, IndexedDB and the Storage API (`navigator.storage.persist`)
  — NFR-07, FR-03.

## Decision Log
- 2026-09-25: Offline entry with later sync; full offline browsing out of scope (concept).
- 2026-09-25: Conflict strategy is mixed: last change wins for personal movements, explicit
  user choice for group movements.
- 2026-09-25: User approved: 100 most recent movements cached for offline view/edit, only
  movements work offline, manual rate when none is stored, pending changes lost on confirmed
  sign out, sync only while the app is open, persistent storage requested with a warning if
  denied.
