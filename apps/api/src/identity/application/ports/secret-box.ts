/**
 * Authenticated encryption of secrets that must be read back, such as TOTP secrets (threat R-42).
 * `associatedData` is authenticated but not encrypted: a sealed value opens only with the same one.
 */
export interface SecretBox {
  seal(plaintext: string, associatedData: string): string;
  /** Throws when the value was tampered with, sealed under another key or other associated data. */
  open(sealed: string, associatedData: string): string;
}

/** No encryption key is configured (only possible outside production). */
export class SecretBoxUnavailable extends Error {
  constructor() {
    super('secret encryption key is not configured');
    this.name = 'SecretBoxUnavailable';
  }
}
