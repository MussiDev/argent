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
  findUserIdByProviderSubject(provider: IdentityProvider, subject: string): Promise<string | null>;
  /**
   * Rejects with `IdentityAlreadyLinked` when the subject is already linked or the user already
   * has an identity of that provider.
   */
  link(identity: NewUserIdentity): Promise<void>;
  deleteNonAuthoritativeForUser(userId: string): Promise<void>;
}
