/ddw-validate-sast docs/ddw/security/sast-DISC-001-03b.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SAST-COVERAGE: all 17 catalogued categories carry a verdict
  ✅ F-SAST-SEVERITY: no Critical or High category filed under a warning marker
  ✅ F-SAST-LOCATION: no findings to locate
  ✅ F-SAST-VERDICT: no Critical/High findings; the result is allowed to pass
  ✅ F-SAST-MEDIUM: 0 Medium finding(s), each fixed or suppressed
  ✅ F-SAST-SUPPRESS: no Critical or High finding is filed as suppressed
  ✅ F-SAST-18: no suppressions to check
  ✅ F-SAST-19: no suppressions to age
────────────────────────────────────────────────────────────────
Total: 8 passed, 0 failed, 0 warnings
Result: PASSED
Scope: this checks the REPORT is complete — every catalogued category judged, every finding located,
       the verdict consistent with the severities, suppressions documented and in date. It does NOT
       scan your code, and it does not know whether a finding is right. That judgement stays the model's.
Report: docs/ddw/security/sast-DISC-001-03b.validation.md
Receipt: .ddw-sessions/sast-validated-d35059acd4c0
Show the user this table IN FULL — every rule ID, every ✅ / ⚠️ / ❌ — and the Report line above it.
This applies to a re-validation of something unchanged too: they are approving what they can see, and
a summary is an approval of the summary. The receipt says the bytes are the same; it does not say anyone read this.
