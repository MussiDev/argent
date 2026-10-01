import type { SignedInResponse } from '@argent/shared';
import type { User } from '../../application/ports/user-repository';

/** The user as a sign-in response shows it (`POST /auth/sign-in`, `POST /auth/2fa/verify`). */
export function signedInUser(user: User): SignedInResponse['user'] {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    language: user.language,
  };
}
