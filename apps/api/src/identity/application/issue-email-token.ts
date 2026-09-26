import type { Clock } from './ports/clock';
import type {
  OneTimeTokenPurpose,
  OneTimeTokenRepository,
} from './ports/one-time-token-repository';
import type { TokenGenerator } from './ports/token-generator';

const MINUTE_MS = 60 * 1000;

/** NFR-04: 24 h for verification links, 60 min for reset links. */
export const EMAIL_TOKEN_TTL_MS: Record<OneTimeTokenPurpose, number> = {
  email_verification: 24 * 60 * MINUTE_MS,
  password_reset: 60 * MINUTE_MS,
};

export interface IssueEmailTokenDependencies {
  /**
   * Bound to the transaction that sends the email, so a failed send leaves no token behind and
   * the issuance lock is held until that transaction ends.
   */
  oneTimeTokens: OneTimeTokenRepository;
  tokenGenerator: TokenGenerator;
  clock: Clock;
}

/**
 * Issues the single valid token of a user and purpose: every unused one is invalidated, the new
 * one is stored only as its hash, and the plaintext is returned to the caller alone (the email
 * worker, which puts it in the link and forgets it; threat R-05, user decision 2026-09-26 A).
 */
export async function issueEmailToken(
  { oneTimeTokens, tokenGenerator, clock }: IssueEmailTokenDependencies,
  userId: string,
  purpose: OneTimeTokenPurpose,
): Promise<string> {
  const now = clock.now();
  // Without it, two workers sending to the same user at once would each invalidate what they can
  // see (not the other's uncommitted token) and both tokens would stay valid.
  await oneTimeTokens.lockIssuance(userId, purpose);
  await oneTimeTokens.invalidateUnused(userId, purpose, now);
  const token = tokenGenerator.generate();
  await oneTimeTokens.create({
    userId,
    purpose,
    tokenHash: tokenGenerator.hash(token),
    expiresAt: new Date(now.getTime() + EMAIL_TOKEN_TTL_MS[purpose]),
  });
  return token;
}
