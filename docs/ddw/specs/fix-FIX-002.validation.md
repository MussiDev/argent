```
/ddw-validate-spec docs/ddw/specs/fix-FIX-002.md — PASSED
────────────────────────────────────────────────────────────────
  ·  F-SPEC-01/02/03 do not apply to FIX (no PRD; the plan answers to the RCA)
  ·  1 step group(s) found
  ✅ F-SPEC-04: every block lists the files it creates or modifies
  ✅ F-SPEC-06: every block lists at least one required test
  ✅ F-SPEC-07: every endpoint carries a complete contract
  ✅ F-SPEC-08: every schema declares its constraints
  ✅ F-SPEC-09: every block taking input documents its validation
  ✅ F-SPEC-10: every block documents its error handling
  ✅ F-SPEC-16: every documented error is named by a test
  ✅ F-SPEC-11: dependencies between blocks are declared
  ✅ F-SPEC-14: the fix-plan declares a regression test
  ✅ F-SPEC-15: the fix-plan has a rollback plan
  ⚠️ W-SPEC-02: large block, consider splitting: Block 1 (Solution steps) (19 files, 1088 words)
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 0 loop(s) since a human decided, under the ceiling of 3; 2 in total for this document
────────────────────────────────────────────────────────────────
Total: 11 passed, 0 failed, 1 warnings
Result: PASSED
```
