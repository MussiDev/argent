```
/ddw-validate-spec docs/ddw/specs/spec-DISC-001-07a.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 20 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 25 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 3 NFR carry a technical strategy
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
  ⚠️ W-SPEC-02: large block, consider splitting: Block 1 (Shared contracts, decimal helpers and valuation arithmetic) (5 files, 806 words), Block 2 (Investments domain rules and ports) (3 files, 602 words), Block 3 (Application use cases and portfolio view) (3 files, 625 words), Block 4 (Persistence: migration 0013 and Drizzle repositories) (7 files, 1011 words), Block 5 (Portfolio routes and module wiring) (5 files, 712 words), Block 6 (Holding routes) (2 files, 963 words), Block 7 (Web API client and formatting helpers) (3 files, 511 words), Block 9 (Web forms) (5 files, 628 words), Block 10 (Web container, route and navigation) (4 files, 528 words)
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 0 loop(s) since a human decided, under the ceiling of 3; 0 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 1 warnings
Result: PASSED
```
