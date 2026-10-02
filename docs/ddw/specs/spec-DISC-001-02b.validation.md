```
/ddw-validate-spec docs/ddw/specs/spec-DISC-001-02b.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 14 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 22 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 3 NFR carry a technical strategy
  ·  9 block(s) found
  ✅ F-SPEC-04: every block lists the files it creates or modifies
  ✅ F-SPEC-05: every block has a verifiable completion criterion
  ✅ F-SPEC-06: every block lists at least one required test
  ✅ F-SPEC-07: every endpoint carries a complete contract
  ✅ F-SPEC-08: every schema declares its constraints
  ✅ F-SPEC-09: every block taking input documents its validation
  ✅ F-SPEC-10: every block documents its error handling
  ✅ F-SPEC-16: every documented error is named by a test
  ✅ F-SPEC-11: dependencies between blocks are declared
  ⚠️ W-SPEC-02: large block, consider splitting: Block 1 (Default catalog and category contracts (packages/shared)) (5 files, 586 words), Block 3 (Categories domain and application (apps/api/src/categories)) (7 files, 878 words), Block 4 (Persistence: table, migration, repository, usage adapter) (8 files, 1388 words), Block 9 (Create defaults when an account is created (identity wiring)) (8 files, 920 words), Block 5 (HTTP routes, wiring and AGENTS.md) (6 files, 909 words), Block 7 (Web categories screens) (7 files, 727 words)
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 0 loop(s) since a human decided, under the ceiling of 3; 4 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 1 warnings
Result: PASSED
```
