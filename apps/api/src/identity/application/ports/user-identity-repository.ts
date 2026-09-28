import type { User } from './user-repository';

export const IDENTITY_PROVIDERS = ['google'] as const;
export type IdentityProvider = (typeof IDENTITY_PROVIDERS)[number];

export interface NewUserIdentity {
  userId: string;
  provider: IdentityProvider;
  /** The provider's stable id for the account (`sub`), never the email. */
  subject: string;
  /**
   * Whether the provider is authoritative for the account's email (PRD FR-07). A password reset
   * removes the identities that are not.
   */
  emailAuthoritative: boolean;
}

/** Links between users and external sign-in identities: one per provider and user. */
export interface UserIdentityRepository {
  /**
   * The user linked to the external account, read in one statement with the link, so the user's
   * credentials version is the one current while the link existed: a reset that removes the link
   * afterwards leaves a session started from it stale (AC-10, threat R-37).
   */
  findUserByProviderSubject(provider: IdentityProvider, subject: string): Promise<User | null>;
  /** Whether the user already has an identity of that provider (at most one per provider). */
  hasProviderIdentity(userId: string, provider: IdentityProvider): Promise<boolean>;
  /**
   * Rejects with `IdentityAlreadyLinked` when the subject is already linked or the user already
   * has an identity of that provider.
   */
  link(identity: NewUserIdentity): Promise<void>;
  deleteNonAuthoritativeForUser(userId: string): Promise<void>;
}
