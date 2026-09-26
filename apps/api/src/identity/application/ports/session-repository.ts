export interface Session {
  id: string;
  userId: string;
  familyId: string;
  refreshTokenHash: string;
  createdAt: Date;
  lastUsedAt: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
}

export interface NewSession {
  userId: string;
  /** Rotation keeps the family; omitted on sign-in, which starts a new one named after the session. */
  familyId?: string;
  /** SHA-256 of the refresh token; the token itself is never stored (threat R-05). */
  refreshTokenHash: string;
  lastUsedAt: Date;
}

export interface SessionRepository {
  create(session: NewSession): Promise<Session>;
  findById(id: string): Promise<Session | null>;
  findByRefreshTokenHash(refreshTokenHash: string): Promise<Session | null>;
  /**
   * Claims a refresh rotation: revokes `id` and records the session that replaced it, only if `id`
   * is not revoked yet. Atomic, so of two concurrent rotations of one session exactly one resolves
   * true; false means the token was already used (reuse, threat R-15).
   */
  markReplaced(id: string, replacedBy: string, at: Date): Promise<boolean>;
  /** Revokes one session; already revoked sessions keep their original `revokedAt`. */
  revoke(id: string, at: Date): Promise<void>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  revokeAllForUser(userId: string, at: Date): Promise<void>;
}
