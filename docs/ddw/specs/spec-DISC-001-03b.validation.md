```
/ddw-validate-spec docs/ddw/specs/spec-DISC-001-03b.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 14 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 24 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 7 NFR carry a technical strategy
  ·  10 block(s) found
  ✅ F-SPEC-04: every block lists the files it creates or modifies
  ✅ F-SPEC-05: every block has a verifiable completion criterion
  ✅ F-SPEC-06: every block lists at least one required test
  ✅ F-SPEC-07: every endpoint carries a complete contract
  ✅ F-SPEC-08: every schema declares its constraints
  ✅ F-SPEC-09: every block taking input documents its validation
  ✅ F-SPEC-10: every block documents its error handling
  ✅ F-SPEC-16: every documented error is named by a test
  ✅ F-SPEC-11: dependencies between blocks are declared
  ⚠️ W-SPEC-02: large block, consider splitting: Block 1 (Shared contracts and helpers) (7 files, 635 words), Block 2 (Domain, ports and use cases) (5 files, 537 words), Block 3 (Persistence: relation, migration 0013 and the repository) (8 files, 966 words), Block 5 (HTTP and composition) (5 files, 647 words), Block 6 (Ordered erasure step, the erasure guard and the import rule) (11 files, 686 words), Block 7 (Obligations of DISC-001-02a and DISC-001-02b, totals and performance) (5 files, 511 words), Block 8 (Web client and the entry screen) (7 files, 673 words), Block 9 (The movements list screen and navigation) (6 files, 374 words), Block 10 (End-to-end flow and cross-cutting scans) (4 files, 706 words)
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 1 loop(s) since a human decided, under the ceiling of 3; 1 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 1 warnings
Result: PASSED
```
