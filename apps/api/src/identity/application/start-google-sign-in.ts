import { newAccountDefaults, type Language } from '../domain/account-defaults';
import { UNKNOWN_IP } from './client-ip';
import type { AttemptLimiter, AttemptPolicy } from './ports/attempt-limiter';
import type { Clock } from './ports/clock';
import {
  GoogleSignInFailed,
  type GoogleIdentityProvider,
  type GoogleSignInFailureReason,
} from './ports/google-identity-provider';
import type { OAuthStateRepository } from './ports/oauth-state-repository';
import type { TokenGenerator } from './ports/token-generator';

/** Threat R-33: 20 Google sign-in starts per client IP per 15 minutes, before any row is written. */
export const GOOGLE_START_IP_POLICY: AttemptPolicy = {
  kind: 'google_start_ip',
  limit: 20,
  windowSeconds: 15 * 60,
};

/** How long the user has to finish at Google; the binding cookie lives as long. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface StartGoogleSignInDependencies {
  attemptLimiter: AttemptLimiter;
  oauthStates: OAuthStateRepository;
  google: GoogleIdentityProvider;
  tokenGenerator: TokenGenerator;
  clock: Clock;
}

export interface StartGoogleSignInInput {
  timeZone?: string | undefined;
  language?: string | undefined;
  ip: string | undefined;
}

/**
 * `started`: send the browser to `authorizationUrl` holding `binding` in a cookie. `failed`: the
 * reason is for logs only; `language` is where to show the error.
 */
export type StartGoogleSignInResult =
  | { outcome: 'started'; authorizationUrl: string; binding: string }
  | {
      outcome: 'failed';
      reason: 'rate_limited' | GoogleSignInFailureReason;
      language: Language;
    };

export class StartGoogleSignIn {
  constructor(private readonly deps: StartGoogleSignInDependencies) {}

  async execute(input: StartGoogleSignInInput): Promise<StartGoogleSignInResult> {
    const attempt = await this.deps.attemptLimiter.record(
      GOOGLE_START_IP_POLICY,
      input.ip ?? UNKNOWN_IP,
    );
    const { timeZone, language } = newAccountDefaults(input);
    if (!attempt.allowed) return { outcome: 'failed', reason: 'rate_limited', language };

    const tokens = this.deps.tokenGenerator;
    const state = tokens.generate();
    const binding = tokens.generate();
    const nonce = tokens.generate();
    const codeVerifier = tokens.generate();

    let authorizationUrl: string;
    try {
      // Built before the state is stored, so an unconfigured provider leaves no row behind.
      authorizationUrl = this.deps.google.authorizationUrl({ state, nonce, codeVerifier });
    } catch (error) {
      if (!(error instanceof GoogleSignInFailed)) throw error;
      return { outcome: 'failed', reason: error.reason, language };
    }

    const now = this.deps.clock.now();
    await this.deps.oauthStates.create({
      stateHash: tokens.hash(state),
      bindingHash: tokens.hash(binding),
      nonceHash: tokens.hash(nonce),
      codeVerifier,
      timeZone,
      language,
      expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS),
    });
    return { outcome: 'started', authorizationUrl, binding };
  }
}
