```
/ddw-validate-spec docs/ddw/specs/spec-DISC-001-01c.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 5 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 7 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 4 NFR carry a technical strategy
  ·  4 block(s) found
  ✅ F-SPEC-04: every block lists the files it creates or modifies
  ✅ F-SPEC-05: every block has a verifiable completion criterion
  ✅ F-SPEC-06: every block lists at least one required test
  ✅ F-SPEC-07: every endpoint carries a complete contract
  ✅ F-SPEC-08: every schema declares its constraints
  ✅ F-SPEC-09: every block taking input documents its validation
  ✅ F-SPEC-10: every block documents its error handling
  ✅ F-SPEC-16: every documented error is named by a test
  ✅ F-SPEC-11: dependencies between blocks are declared
  ⚠️ W-SPEC-02: large block, consider splitting: Block 1 (TOTP engine, secret encryption and persistence) (32 files, 1315 words), Block 2 (Enrollment, disabling and notices) (7 files, 1015 words), Block 3 (Second step of sign-in) (12 files, 1114 words), Block 4 (Web: security settings and second-factor screen) (18 files, 1050 words)
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 1 loop(s) since a human decided, under the ceiling of 3; 2 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 1 warnings
Result: PASSED
```
