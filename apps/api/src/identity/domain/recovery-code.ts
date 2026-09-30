/** Recovery codes issued when 2FA is enabled (FR-03). */
export const RECOVERY_CODE_COUNT = 10;

/** Crockford base32: no I, L, O or U, so a code read aloud or retyped is not misread. */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_CODE_LENGTH = 10;

const STORED_FORM = new RegExp(`^[${CROCKFORD_ALPHABET}]{${RECOVERY_CODE_LENGTH}}$`);
const HALF = RECOVERY_CODE_LENGTH / 2;

/** `ABCDE12345` → `ABCDE-12345`, the form shown to the user. */
export function formatRecoveryCode(code: string): string {
  return `${code.slice(0, HALF)}-${code.slice(HALF)}`;
}

/**
 * The stored form of what a user typed: upper-cased, without spaces or dashes, with `I` and `L`
 * read as `1` and `O` as `0` (Crockford's decoding). Null when the result is not a code.
 */
export function normalizeRecoveryCode(input: string): string | null {
  // ASCII only: `toUpperCase` would turn characters such as `ß` into letters of the alphabet.
  const normalized = input
    .replace(/[a-z]/g, (letter) => letter.toUpperCase())
    .replace(/[ -]/g, '')
    .replace(/[IL]/g, '1')
    .replaceAll('O', '0');
  return STORED_FORM.test(normalized) ? normalized : null;
}
