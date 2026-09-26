```
/ddw-validate-spec docs/ddw/specs/spec-DISC-001-01a.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 11 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 22 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 11 NFR carry a technical strategy
  ·  7 block(s) found
  ✅ F-SPEC-04: every block lists the files it creates or modifies
  ✅ F-SPEC-05: every block has a verifiable completion criterion
  ✅ F-SPEC-06: every block lists at least one required test
  ✅ F-SPEC-07: every endpoint carries a complete contract
  ✅ F-SPEC-08: every schema declares its constraints
  ✅ F-SPEC-09: every block taking input documents its validation
  ✅ F-SPEC-10: every block documents its error handling
  ✅ F-SPEC-16: every documented error is named by a test
  ✅ F-SPEC-11: dependencies between blocks are declared
  ⚠️ W-SPEC-01: block referencing no FR — enabler or gold-plating?: Block 1 (Monorepo foundation)
  ⚠️ W-SPEC-02: large block, consider splitting: Block 1 (Monorepo foundation) (38 files, 770 words), Block 2 (Identity domain, ports and persistence) (25 files, 800 words), Block 3 (Registration, email verification and email outbox) (18 files, 702 words), Block 4 (Sign-in, sessions and sign-out) (16 files, 724 words), Block 5 (Password reset) (6 files, 339 words), Block 6 (Access control) (9 files, 432 words), Block 7 (Web authentication screens) (15 files, 634 words)
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 1 loop(s) since a human decided, under the ceiling of 3; 1 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 2 warnings
Result: PASSED
```
