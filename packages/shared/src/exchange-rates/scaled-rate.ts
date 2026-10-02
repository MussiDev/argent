export const RATE_SCALE_DECIMALS = 4;
export const RATE_SCALE = 10_000n;
/** 10,000,000.0000 scaled by 10,000. */
export const RATE_MAX_SCALED = 100_000_000_000n;

const RATE_TEXT_PATTERN = /^(0|[1-9]\d*)(\.\d+)?$/;

/**
 * Parses the exact decimal text of a provider number into a rate scaled by 10,000. Works on the
 * digit string so the value never goes through a float. Returns null for malformed, zero or
 * oversized input; never throws.
 */
export function parseScaledRate(text: string): bigint | null {
  if (!RATE_TEXT_PATTERN.test(text)) {
    return null;
  }
  const [whole = '0', fraction = ''] = text.split('.');
  const kept = fraction.slice(0, RATE_SCALE_DECIMALS).padEnd(RATE_SCALE_DECIMALS, '0');
  let scaled = BigInt(whole + kept);
  const roundingDigit = fraction.charAt(RATE_SCALE_DECIMALS);
  if (roundingDigit !== '' && roundingDigit >= '5') {
    scaled += 1n;
  }
  if (scaled < 1n || scaled > RATE_MAX_SCALED) {
    return null;
  }
  return scaled;
}

export function formatScaledRate(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(RATE_SCALE_DECIMALS + 1, '0');
  const split = digits.length - RATE_SCALE_DECIMALS;
  return `${negative ? '-' : ''}${digits.slice(0, split)}.${digits.slice(split)}`;
}
