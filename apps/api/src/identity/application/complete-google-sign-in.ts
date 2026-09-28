import { newAccountDefaults, type Language } from '../domain/account-defaults';
import { Email } from '../domain/email';
import { DuplicateEmail, IdentityAlreadyLinked } from '../domain/errors';
import { isGoogleAuthoritative } from '../domain/google-authority';
import type { Clock } from './ports/clock';
import {
  GoogleSignInFailed,
  type GoogleClaims,
  type GoogleIdentityProvider,
  type GoogleSignInFailureReason,
} from './ports/google-identity-provider';
import type { OAuthState, OAuthStateRepository } from './ports/oauth-state-repository';
import type { TokenGenerator } from './ports/token-generator';
import type { TransactionalRepositories, UnitOfWork } from './ports/unit-of-work';
import type { User } from './ports/user-repository';
import type { SessionTokens, StartSession } from './start-session';

export interface CompleteGoogleSignInDependencies {
  oauthStates: OAuthStateRepository;
  google: GoogleIdentityProvider;
  tokenGenerator: TokenGenerator;
  unitOfWork: UnitOfWork;
  startSession: StartSession;
  clock: Clock;
}

export interface CompleteGoogleSignInInput {
  /** Every parameter of Google's redirect; a repeated one arrives as an array. */
  params: Readonly<Record<string, string | readonly string[] | undefined>>;
  /** The binding cookie set by the start of this flow. */
  binding: string | undefined;
}

export type GoogleSignInFailure =
  | 'repeated_parameter'
  | 'missing_state'
  | 'missing_binding'
  | 'unknown_state'
  | 'denied_at_google'
  | 'missing_code'
  | 'email_unverified'
  | 'email_not_authoritative'
  | 'another_identity_linked'
  | 'conflict'
  | GoogleSignInFailureReason;

/** How the signed-in user was reached; for logs. */
export type GoogleSignInPath = 'existing_identity' | 'linked' | 'superseded' | 'created';

/**
 * Every expected failure is one outcome, answered the same way (threat R-29); `reason` is for logs
 * only and `language` is the consumed state's, when there was one.
 */
export type CompleteGoogleSignInResult =
  | { outcome: 'signed_in'; via: GoogleSignInPath; user: User; session: SessionTokens }
  | { outcome: 'failed'; reason: GoogleSignInFailure; language: Language | null };

type AccountResult =
  | { outcome: 'resolved'; via: GoogleSignInPath; user: User }
  | { outcome: 'refused'; reason: GoogleSignInFailure };

export class CompleteGoogleSignIn {
  constructor(private readonly deps: CompleteGoogleSignInDependencies) {}

  async execute({
    params,
    binding,
  }: CompleteGoogleSignInInput): Promise<CompleteGoogleSignInResult> {
    const fail = (reason: GoogleSignInFailure, language: Language | null = null) =>
      ({ outcome: 'failed', reason, language }) as const;

    if (Object.values(params).some((value) => Array.isArray(value))) {
      return fail('repeated_parameter');
    }
    const { state, code, error } = params;
    if (typeof state !== 'string') return fail('missing_state');
    if (!binding) return fail('missing_binding');

    const tokens = this.deps.tokenGenerator;
    const pending = await this.deps.oauthStates.consume(
      tokens.hash(state),
      tokens.hash(binding),
      this.deps.clock.now(),
    );
    if (!pending) return fail('unknown_state');
    // From here on the state is spent: every failure shows the error in the flow's language.
    if (error !== undefined) return fail('denied_at_google', pending.language);
    if (typeof code !== 'string') return fail('missing_code', pending.language);

    let claims: GoogleClaims;
    try {
      claims = await this.deps.google.exchangeCode({
        code,
        codeVerifier: pending.codeVerifier,
        expectedNonceHash: pending.nonceHash,
      });
    } catch (exchangeError) {
      if (!(exchangeError instanceof GoogleSignInFailed)) throw exchangeError;
      return fail(exchangeError.reason, pending.language);
    }
    // AC-05, AC-08 (FR-06): an unverified Google email never creates, links or signs in.
    if (!claims.emailVerified) return fail('email_unverified', pending.language);

    const account = await this.resolveAccountWithRetry(claims, pending);
    if (account.outcome === 'refused') return fail(account.reason, pending.language);

    // The user as read in the transaction: a password change committed after it makes this
    // session stale, never the other way round (AC-10).
    const session = await this.deps.startSession.execute(account.user);
    return { outcome: 'signed_in', via: account.via, user: account.user, session };
  }

  /**
   * A concurrent callback for the same Google account or email aborts the transaction with a
   * unique violation; one fresh transaction then sees what the other one committed (threat R-35).
   */
  private async resolveAccountWithRetry(
    claims: GoogleClaims,
    pending: OAuthState,
  ): Promise<AccountResult> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.deps.unitOfWork.run((repositories) =>
          this.resolveAccount(repositories, claims, pending),
        );
      } catch (error) {
        const conflict = error instanceof DuplicateEmail || error instanceof IdentityAlreadyLinked;
        if (!conflict) throw error;
        if (attempt === 2) return { outcome: 'refused', reason: 'conflict' };
      }
    }
  }

  private async resolveAccount(
    { users, identities, sessions }: TransactionalRepositories,
    claims: GoogleClaims,
    pending: OAuthState,
  ): Promise<AccountResult> {
    const now = this.deps.clock.now();
    const authoritative = isGoogleAuthoritative(claims.email, claims.hostedDomain);
    const link = (userId: string) =>
      identities.link({
        userId,
        provider: 'google',
        subject: claims.subject,
        emailAuthoritative: authoritative,
      });

    // AC-03: a known Google account signs in to its user, whatever its email says now. User and
    // link are read together: a reset removing the link later leaves this session stale (R-37).
    const linked = await identities.findUserByProviderSubject('google', claims.subject);
    if (linked) return { outcome: 'resolved', via: 'existing_identity', user: linked };

    const email = Email.parse(claims.email);
    const existing = await users.findByEmail(email);
    if (existing) {
      // AC-09 (FR-07): Google may merely claim an address someone else owns now.
      if (!authoritative) return { outcome: 'refused', reason: 'email_not_authoritative' };
      // One Google account per user: a second one with the same email is refused, not relinked.
      if (await identities.hasProviderIdentity(existing.id, 'google')) {
        return { outcome: 'refused', reason: 'another_identity_linked' };
      }
      if (existing.emailVerifiedAt) {
        await link(existing.id); // AC-06 (FR-04)
        return { outcome: 'resolved', via: 'linked', user: existing };
      }
      // AC-07 (FR-05): whoever registered the unverified password account loses it.
      const superseded = await users.supersedeUnverified(existing.id, now);
      if (!superseded) {
        // Verified between the two statements: link it as a verified account.
        await link(existing.id);
        return {
          outcome: 'resolved',
          via: 'linked',
          user: (await users.findById(existing.id)) ?? existing,
        };
      }
      await sessions.revokeAllForUser(existing.id, now);
      await link(existing.id);
      return { outcome: 'resolved', via: 'superseded', user: superseded };
    }

    // AC-01, AC-04 (FR-01, FR-03): verified by Google, so no verification email is sent.
    const { defaultRateType, displayCurrency } = newAccountDefaults({});
    const created = await users.create({
      email,
      passwordHash: null,
      emailVerifiedAt: now,
      defaultRateType,
      displayCurrency,
      timeZone: pending.timeZone,
      language: pending.language,
    });
    await link(created.id);
    return { outcome: 'resolved', via: 'created', user: created };
  }
}
