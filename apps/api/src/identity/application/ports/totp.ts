/** Time-based one-time passwords (RFC 6238) for the second factor (NFR-03). */
export interface TotpEngine {
  /** A new random secret, base32 (RFC 4648) without padding. */
  generateSecret(): string;
  /**
   * The time step `code` matches for `secret` at `now`, within one step before or after; null when
   * it matches none. The caller must still refuse a step not later than the last one accepted.
   */
  verify(secret: string, code: string, now: Date): number | null;
  /** The `otpauth://` URI an authenticator app reads from the QR code. */
  otpauthUri(secret: string, accountEmail: string): string;
}
