/** A recovery code, stored only as an Argon2id hash (NFR-02). */
export interface StoredRecoveryCode {
  id: string;
  userId: string;
  codeHash: string;
  usedAt: Date | null;
  createdAt: Date;
}

export interface RecoveryCodeRepository {
  /** Replaces every code of the user with `hashes`, atomically. */
  replaceAll(userId: string, hashes: readonly string[]): Promise<void>;
  findUnused(userId: string): Promise<StoredRecoveryCode[]>;
  /** Marks the code used only if it is still unused; atomic, so a code is spent at most once. */
  markUsed(id: string, at: Date): Promise<boolean>;
  countUnused(userId: string): Promise<number>;
  deleteAll(userId: string): Promise<void>;
}
