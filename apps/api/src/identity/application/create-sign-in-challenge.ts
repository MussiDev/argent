import type { Language } from '../domain/account-defaults';
import type { Clock } from './ports/clock';
import type { SignInChallengeRepository, SignInVia } from './ports/sign-in-challenge-repository';
import type { TokenGenerator } from './ports/token-generator';

/** How long a first factor waits for the second one (threat R-43). */
export const SIGN_IN_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface CreateSignInChallengeDependencies {
  signInChallenges: SignInChallengeRepository;
  tokenGenerator: TokenGenerator;
  clock: Clock;
}

export interface CreateSignInChallengeInput {
  userId: string;
  /** Read together with the first factor; a change before the second one invalidates it. */
  credentialsVersion: number;
  via: SignInVia;
  language: Language;
}

/**
 * Stores a sign-in challenge for a user with 2FA whose first factor passed (FR-04). Resolves the
 * token for the browser's cookie; only its hash is stored (threat R-43).
 */
export class CreateSignInChallenge {
  constructor(private readonly deps: CreateSignInChallengeDependencies) {}

  async execute(input: CreateSignInChallengeInput): Promise<string> {
    const token = this.deps.tokenGenerator.generate();
    await this.deps.signInChallenges.create({
      ...input,
      tokenHash: this.deps.tokenGenerator.hash(token),
      expiresAt: new Date(this.deps.clock.now().getTime() + SIGN_IN_CHALLENGE_TTL_MS),
    });
    return token;
  }
}
