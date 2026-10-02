# TDD evidence DISC-001-03b

Red-phase evidence per block, written block by block as the work happens, from the implementer's report of each block and
checked by that block's verifier. Where a test file could not even load (a missing module or export, so no individual assertion
ran) the red result is that failure and no per-assertion line exists; this is said explicitly. Paths are relative to the repository
root.

## Block 1 — Shared contracts and helpers (27 tests)

All four new test files failed before the implementation existed because the exports they import were undefined, so no individual
assertion ran in the red run; each failed with a `TypeError` on the missing export.

| Test file | Tests | Red result |
|---|---|---|
| `packages/shared/test/movement-schemas.test.ts` | 12 | `TypeError: Cannot read properties of undefined (reading 'safeParse')` (the schemas did not exist) |
| `packages/shared/test/rate-age.test.ts` | 3 | undefined-export `TypeError` (`rateAgeMs`, `RATE_AGE_BASIS`) |
| `packages/shared/test/zoned-time.test.ts` | 9 | undefined-export `TypeError` (`todayInTimeZone`, `dateInTimeZone`, `zonedLocalToInstant`, `instantToZonedLocal`) |
| `packages/shared/test/rate-input.test.ts` | 3 | undefined-export `TypeError` (`parseRateInput`, `formatRateInput`) |

After: 27/27, shared suite 63/63, `pnpm typecheck` clean. The first implementation run was green.

Round 2 (review fixes): two tests failed first (2 failed, 63 passed). `parseRateInput('1623.3', 'x')` threw `RangeError: Incorrect locale information provided` (a malformed locale tag must not throw); and the NFC/NFD note test failed with `expected 'café' to be 'café'` (the NFD form was stored as typed). Both were then fixed (the rate-input separators fall back and are cached per locale, the note is NFC-normalized); the zone-validation memo added in the same round changes no observable behavior and has no new test. After: shared suite 65/65.

