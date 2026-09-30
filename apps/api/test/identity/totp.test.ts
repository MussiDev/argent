import { describe, expect, it } from 'vitest';
import { hotp, RfcTotpEngine } from '../../src/identity/infrastructure/security/totp';

/** The RFC 6238 Appendix B SHA-1 seed, ASCII "12345678901234567890", in base32. */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const STEP_SECONDS = 30;

const at = (unixSeconds: number) => new Date(unixSeconds * 1000);

describe('RfcTotpEngine', () => {
  const engine = new RfcTotpEngine();

  // RFC 6238 Appendix B, SHA-1 column, keeping the last 6 of the 8 digits.
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('matches the RFC 6238 SHA-1 vector at T=%i (NFR-03)', (unixSeconds, eightDigits) => {
    const code = eightDigits.slice(-6);
    const step = Math.floor(unixSeconds / STEP_SECONDS);

    expect(hotp(RFC_SECRET, step)).toBe(code);
    expect(engine.verify(RFC_SECRET, code, at(unixSeconds))).toBe(step);
  });

  it('accepts the previous, current and next step and rejects two steps away (NFR-03, sad path)', () => {
    const now = at(1111111111);
    const current = Math.floor(1111111111 / STEP_SECONDS);

    for (const offset of [-1, 0, 1]) {
      expect(engine.verify(RFC_SECRET, hotp(RFC_SECRET, current + offset), now)).toBe(
        current + offset,
      );
    }
    for (const offset of [-2, 2]) {
      expect(engine.verify(RFC_SECRET, hotp(RFC_SECRET, current + offset), now)).toBeNull();
    }
  });

  it('accepts a code at the edges of its window', () => {
    const step = 40_000_000;
    const code = hotp(RFC_SECRET, step);
    const stepStart = step * STEP_SECONDS;

    // From the first second of the step before to the last second of the step after.
    expect(engine.verify(RFC_SECRET, code, at(stepStart - STEP_SECONDS))).toBe(step);
    expect(engine.verify(RFC_SECRET, code, at(stepStart + 2 * STEP_SECONDS - 1))).toBe(step);
    expect(engine.verify(RFC_SECRET, code, at(stepStart - STEP_SECONDS - 1))).toBeNull();
    expect(engine.verify(RFC_SECRET, code, at(stepStart + 2 * STEP_SECONDS))).toBeNull();
  });

  it.each(['', '12345', '1234567', '12345a', ' 123456', '１２３４５６'])(
    'rejects the malformed code %j (sad path)',
    (code) => {
      // The well-formed code for the same instant is accepted, so only the format is refused.
      expect(engine.verify(RFC_SECRET, '287082', at(59))).toBe(1);
      expect(engine.verify(RFC_SECRET, code, at(59))).toBeNull();
    },
  );

  it('generates random 160-bit secrets in unpadded base32', () => {
    const secrets = new Set(Array.from({ length: 100 }, () => engine.generateSecret()));

    expect(secrets.size).toBe(100);
    for (const secret of secrets) expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const [secret = ''] = secrets;
    expect(engine.verify(secret, hotp(secret, 1), at(30))).toBe(1);
  });

  it('builds an otpauth URI with the issuer Pesly and a percent-encoded email (FR-01)', () => {
    const uri = engine.otpauthUri(RFC_SECRET, 'ana+argent@example.com');

    expect(uri).toBe(
      `otpauth://totp/Pesly:ana%2Bargent%40example.com?secret=${RFC_SECRET}&issuer=Pesly&algorithm=SHA1&digits=6&period=30`,
    );
    const parsed = new URL(uri);
    expect(parsed.searchParams.get('issuer')).toBe('Pesly');
    expect(parsed.host).toBe('totp');
    expect(decodeURIComponent(parsed.pathname)).toBe('/Pesly:ana+argent@example.com');
  });
});
