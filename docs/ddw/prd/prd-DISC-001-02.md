# Parent PRD: Accounts & Categories

| Metric | Value |
|--------|-------|
| Ticket | DISC-001-02 |
| Date | 2026-10-01 |
| Status | Split |

## Sub-tickets

| Sub-ticket | Title | PRD | Dependencies | Status |
|---|---|---|---|---|
| DISC-001-02a | Accounts | prd-DISC-001-02a.md | PRD 01a (users, ownership) | done — on its draft PR, merges when the PR merges; migration 0006's journal `when` is intentionally later than 0007's (0007 is already deployed), do not lower it |
| DISC-001-02b | Categories | prd-DISC-001-02b.md | PRD 01a (users, ownership); FR-11 needs the interface language from PRD 01 (01d); independent of a | done — on its draft PR, merges when the PR merges; migration 0009's journal `when` is later than every other entry, the later-merging ticket re-chains the snapshot |

## Suggested implementation order
a → b

## Pending decisions (not resolved in the sub-PRDs)
- RESOLVED (2026-10-01, human decision): FR-08 / AC-10 / AC-11 of 02a (original FR-08, AC-10,
  AC-11) mention movements, which exist only from PRD 03. Balance = opening balance + sum of
  movements, where the movement sum and the "account has movements" check sit behind an
  application port in the accounts module. In 02a the only adapter returns 0 / false (no
  movements exist yet) and no movements table is created; PRD 03 provides the real adapter
  without touching accounts code. AC-10 is tested at the use-case level with a fake port that
  reports movements; its end-to-end test is deferred to PRD 03. The PRD wording is unchanged.
- RESOLVED (2026-10-01, human decision Q3): FR-11 / AC-14 of 02b (original FR-22, AC-27) now say
  default categories follow the user's CURRENT interface language and are shown translated when it
  changes; a default the user renames becomes theirs and is no longer translated. New in 02b:
  FR-12 and AC-15 to AC-17.
- RESOLVED (2026-10-01, human decision Q4): categories get their own module
  (`apps/api/src/categories/`) and web feature; `categories` joins the module list of AGENTS.md.

## Original context
PRD 02 of discovery DISC-001 defined the accounts where a user's money is and the categories that
say what it was for. With 22 functional requirements and 27 acceptance criteria it was too large
for one ticket, and accounts and categories are independent halves, so it was split on 2026-10-01
(user decision). The full original text is in git history (file `docs/ddw/prd/prd-DISC-001-02.md`
before the split).

## Traceability: original ID → sub-ticket ID

Other PRDs of DISC-001 reference this PRD as "PRD 02, FR-xx"; use this table to resolve them.

| Original | Now |
|---|---|
| FR-01 | DISC-001-02a FR-01 |
| FR-02 | DISC-001-02a FR-02 |
| FR-03 | DISC-001-02a FR-03 |
| FR-04 | DISC-001-02a FR-04 |
| FR-05 | DISC-001-02a FR-05 |
| FR-06 | DISC-001-02a FR-06 |
| FR-07 | DISC-001-02a FR-07 |
| FR-08 | DISC-001-02a FR-08 |
| FR-09 | DISC-001-02a FR-09 |
| FR-10 | DISC-001-02a FR-10 |
| FR-11 | DISC-001-02b FR-01 |
| FR-12 | DISC-001-02b FR-02 |
| FR-13 | DISC-001-02b FR-03 |
| FR-14 | DISC-001-02b FR-05 |
| FR-15 | DISC-001-02b FR-06 |
| FR-16 | DISC-001-02b FR-07 |
| FR-17 | DISC-001-02b FR-08 |
| FR-18 | DISC-001-02b FR-09 |
| FR-19 | DISC-001-02a FR-11 |
| FR-20 | DISC-001-02b FR-04 |
| FR-21 | DISC-001-02a FR-12 (accounts) and DISC-001-02b FR-10 (categories) |
| FR-22 | DISC-001-02b FR-11 |
| NFR-01 | DISC-001-02a NFR-01 |
| NFR-02 | DISC-001-02a NFR-02 |
| NFR-03 | DISC-001-02a NFR-03 and DISC-001-02b NFR-01 |
| NFR-04 | DISC-001-02a NFR-04 and DISC-001-02b NFR-02 |
| NFR-05 | DISC-001-02a NFR-05 and DISC-001-02b NFR-03 |
| AC-01 | DISC-001-02a AC-01 |
| AC-02 | DISC-001-02a AC-02 |
| AC-03 | DISC-001-02a AC-03 |
| AC-04 | DISC-001-02a AC-04 |
| AC-05 | DISC-001-02a AC-05 |
| AC-06 | DISC-001-02a AC-06 |
| AC-07 | DISC-001-02a AC-07 |
| AC-08 | DISC-001-02a AC-08 |
| AC-09 | DISC-001-02a AC-09 |
| AC-10 | DISC-001-02a AC-10 |
| AC-11 | DISC-001-02a AC-11 |
| AC-12 | DISC-001-02a AC-12 |
| AC-13 | DISC-001-02b AC-01 |
| AC-14 | DISC-001-02b AC-02 |
| AC-15 | DISC-001-02b AC-03 |
| AC-16 | DISC-001-02b AC-04 |
| AC-17 | DISC-001-02b AC-05 |
| AC-18 | DISC-001-02b AC-06 |
| AC-19 | DISC-001-02b AC-07 |
| AC-20 | DISC-001-02b AC-08 |
| AC-21 | DISC-001-02b AC-09 |
| AC-22 | DISC-001-02b AC-10 |
| AC-23 | DISC-001-02b AC-11 |
| AC-24 | DISC-001-02a AC-13 |
| AC-25 | DISC-001-02a AC-14 (accounts) and DISC-001-02b AC-12 (categories) |
| AC-26 | DISC-001-02a AC-15 (accounts) and DISC-001-02b AC-13 (categories) |
| AC-27 | DISC-001-02b AC-14 |
