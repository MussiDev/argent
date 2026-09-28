# Parent PRD: Identity & Access

| Metric | Value |
|--------|-------|
| Ticket | DISC-001-01 |
| Date | 2026-09-26 |
| Status | Split |

## Sub-tickets

| Sub-ticket | Title | PRD | Dependencies | Status |
|---|---|---|---|---|
| DISC-001-01a | Email & Password Authentication (+ project foundation) | prd-DISC-001-01a.md | none | done — draft PR #2; 01b branches off this branch until #2 merges |
| DISC-001-01b | Google Sign-In | prd-DISC-001-01b.md | depends on a | active |
| DISC-001-01c | Two-Factor Authentication | prd-DISC-001-01c.md | depends on a | pending |
| DISC-001-01d | Profile, Preferences & Account Deletion | prd-DISC-001-01d.md | depends on a; shows 2FA status from c | pending |

## Suggested implementation order
a → d → b → c

## Original context
PRD 01 of discovery DISC-001 defined identity and access for the finance PWA: open registration
with email/password or Google, optional TOTP 2FA, sessions, password reset, per-user preferences
(rate type, display currency, time zone, language), account deletion and access control. With
27 functional requirements and 45 acceptance criteria it was too large for one ticket, and the
first ticket also has to lay the project foundation, so it was split on 2026-09-26 (user
decision). The full original text is in git history (commit on `main`, file
`docs/ddw/prd/prd-DISC-001-01.md` before the split).

## Traceability: original ID → sub-ticket ID

Other PRDs of DISC-001 reference this PRD as "PRD 01, FR-xx"; use this table to resolve them.

| Original | Now |
|---|---|
| FR-01 | DISC-001-01a FR-01 |
| FR-02 | DISC-001-01a FR-02 |
| FR-03 | DISC-001-01b FR-01 |
| FR-04 | DISC-001-01a FR-03 |
| FR-05 | DISC-001-01a FR-04 |
| FR-06 | DISC-001-01c FR-01 |
| FR-07 | DISC-001-01c FR-04 |
| FR-08 | DISC-001-01a FR-05 |
| FR-09 | DISC-001-01d FR-02 |
| FR-10 | DISC-001-01d FR-04 |
| FR-11 | DISC-001-01b FR-04 |
| FR-12 | DISC-001-01d FR-08 |
| FR-13 | DISC-001-01a FR-07 |
| FR-14 | DISC-001-01b FR-02 |
| FR-15 | DISC-001-01b FR-03 |
| FR-16 | DISC-001-01c FR-02 |
| FR-17 | DISC-001-01c FR-03 |
| FR-18 | DISC-001-01a FR-06 |
| FR-19 | DISC-001-01d FR-01 |
| FR-20 | DISC-001-01d FR-03 |
| FR-21 | DISC-001-01d FR-05 |
| FR-22 | DISC-001-01a FR-09 |
| FR-23 | DISC-001-01a FR-08 |
| FR-24 | DISC-001-01d FR-06 |
| FR-25 | DISC-001-01a FR-10 |
| FR-26 | DISC-001-01d FR-07 |
| FR-27 | DISC-001-01a FR-11 |
| AC-01 | DISC-001-01a AC-01 |
| AC-02 | DISC-001-01a AC-02 |
| AC-03 | DISC-001-01a AC-04 |
| AC-04 | DISC-001-01a AC-05 |
| AC-05 | DISC-001-01a AC-06 |
| AC-06 | DISC-001-01b AC-01 |
| AC-07 | DISC-001-01b AC-02 |
| AC-08 | DISC-001-01a AC-07 |
| AC-09 | DISC-001-01a AC-08 |
| AC-10 | DISC-001-01a AC-09 |
| AC-11 | DISC-001-01a AC-10 |
| AC-12 | DISC-001-01c AC-01 |
| AC-13 | DISC-001-01c AC-03 |
| AC-14 | DISC-001-01c AC-04 |
| AC-15 | DISC-001-01c AC-05 |
| AC-16 | DISC-001-01a AC-12 |
| AC-17 | DISC-001-01a AC-13 |
| AC-18 | DISC-001-01d AC-02 |
| AC-19 | DISC-001-01d AC-05 |
| AC-20 | DISC-001-01a AC-18 |
| AC-21 | DISC-001-01b AC-06 |
| AC-22 | DISC-001-01b AC-07 |
| AC-23 | DISC-001-01d AC-10 |
| AC-24 | DISC-001-01a AC-14 |
| AC-25 | DISC-001-01a AC-15 |
| AC-26 | DISC-001-01b AC-03 |
| AC-27 | DISC-001-01b AC-04 |
| AC-28 | DISC-001-01c AC-02 |
| AC-29 | DISC-001-01d AC-03 |
| AC-30 | DISC-001-01d AC-01 |
| AC-31 | DISC-001-01d AC-04 |
| AC-32 | DISC-001-01d AC-06 |
| AC-33 | DISC-001-01a AC-16 |
| AC-34 | DISC-001-01a AC-17 |
| AC-35 | DISC-001-01a AC-11 |
| AC-36 | DISC-001-01a AC-03 |
| AC-37 | DISC-001-01b AC-05 |
| AC-38 | DISC-001-01d AC-11 |
| AC-39 | DISC-001-01d AC-07 |
| AC-40 | DISC-001-01d AC-08 |
| AC-41 | DISC-001-01a AC-19 |
| AC-42 | DISC-001-01a AC-20 |
| AC-43 | DISC-001-01d AC-09 |
| AC-44 | DISC-001-01a AC-21 |
| AC-45 | DISC-001-01a AC-22 |
