import type { Language } from '../../domain/account-defaults';

export const SIGN_IN_VIAS = ['password', 'google'] as const;
/** The first factor that created the challenge. */
export type SignInVia = (typeof SIGN_IN_VIAS)[number];

/**
 * A first factor passed by a user with 2FA, waiting for the second one. Only the SHA-256 of its
 * token is stored (threat R-43).
 */
export interface SignInChallenge {
  tokenHash: string;
  userId: string;
  /** The user's credentials version at the first factor; a change in between invalidates it. */
  credentialsVersion: number;
  via: SignInVia;
  /** Language of the redirects that finish the sign-in. */
  language: Language;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
}

export type NewSignInChallenge = Omit<SignInChallenge, 'attempts' | 'createdAt'>;

export interface SignInChallengeRepository {
  create(challenge: NewSignInChallenge): Promise<void>;
  /** The challenge if it exists and has not expired at `now`; takes no lock. */
  findLive(tokenHash: string, now: Date): Promise<SignInChallenge | null>;
  /**
   * Like `findLive`, but locks the row (`select ... for update`) until the current transaction
   * ends. Must run inside a unit of work.
   */
  lockLive(tokenHash: string, now: Date): Promise<SignInChallenge | null>;
  /** Counts one more attempt and resolves the new total; rejects when the challenge is gone. */
  recordAttempt(tokenHash: string): Promise<number>;
  /** Deletes the challenge; resolves true only for the caller that deleted it. */
  consume(tokenHash: string): Promise<boolean>;
  deleteForUser(userId: string): Promise<void>;
}
