import {
  GoogleSignInFailed,
  type GoogleClaims,
  type GoogleIdentityProvider,
} from '../../application/ports/google-identity-provider';

/** Stands in when GOOGLE_CLIENT_ID is unset outside production: Google sign-in always fails. */
export class UnconfiguredGoogleIdentityProvider implements GoogleIdentityProvider {
  authorizationUrl(): string {
    throw new GoogleSignInFailed('not_configured');
  }

  exchangeCode(): Promise<GoogleClaims> {
    return Promise.reject(new GoogleSignInFailed('not_configured'));
  }
}
