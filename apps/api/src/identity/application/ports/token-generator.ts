/** Secrets for links and refresh tokens, and the one-way hash stored in their place. */
export interface TokenGenerator {
  /** 256 random bits, base64url without padding (43 characters). */
  generate(): string;
  /** SHA-256 of the token, hex encoded. */
  hash(token: string): string;
}
