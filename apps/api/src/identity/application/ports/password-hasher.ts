/** Hashes and verifies passwords (Argon2id in production, NFR-01). */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** Resolves false for a wrong password or a malformed hash; never throws for either. */
  verify(passwordHash: string, password: string): Promise<boolean>;
}
