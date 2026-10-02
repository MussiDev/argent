```
/ddw-validate-spec docs/ddw/specs/spec-DISC-001-02a.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 14 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 22 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 6 NFR carry a technical strategy
  ·  11 block(s) found
  ✅ F-SPEC-04: every block lists the files it creates or modifies
  ✅ F-SPEC-05: every block has a verifiable completion criterion
  ✅ F-SPEC-06: every block lists at least one required test
  ✅ F-SPEC-07: every endpoint carries a complete contract
  ✅ F-SPEC-08: every schema declares its constraints
  ✅ F-SPEC-09: every block taking input documents its validation
  ✅ F-SPEC-10: every block documents its error handling
  ✅ F-SPEC-16: every documented error is named by a test
  ✅ F-SPEC-11: dependencies between blocks are declared
  ⚠️ W-SPEC-01: block referencing no FR — enabler or gold-plating?: Block 8 (End-to-end, performance and boundary tests)
  ⚠️ W-SPEC-02: large block, consider splitting: Block 1 (Money helpers and account contracts (packages/shared)) (5 files, 722 words), Block 2 (Error codes wiring (shared, API error handler, web client)) (6 files, 241 words), Block 3 (Accounts domain and application (apps/api/src/accounts)) (8 files, 731 words), Block 4 (Persistence: table, migration, repository, movements adapter) (11 files, 833 words), Block 5 (HTTP routes and wiring) (5 files, 855 words), Block 7 (Web accounts screens) (9 files, 650 words), Block 10 (Exact balances and totals, bound enforced in the database and the routes (API)) (5 files, 737 words), Block 11 (Web messages for the new rules and end-to-end coverage) (5 files, 529 words)
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 0 loop(s) since a human decided, under the ceiling of 3; 4 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 2 warnings
Result: PASSED
```
