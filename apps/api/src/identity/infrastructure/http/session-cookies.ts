import type { CookieOptions } from 'express';
import type { ResponseFacade } from '../../../shared/http/validate';
import { SESSION_IDLE_LIMIT_MS } from '../../application/get-current-session';
import { SIGN_IN_CHALLENGE_TTL_MS } from '../../application/create-sign-in-challenge';
import { DELETION_GRANT_TTL_MS } from '../../application/delete-user';
import type { SessionTokens } from '../../application/start-session';

/** `__Host-`: the browser enforces Secure, Path=/ and no Domain, so it stays host-only (NFR-11). */
export const ACCESS_TOKEN_COOKIE = '__Host-argent_at';
/** `__Secure-` with Path=/auth: the refresh token is only ever sent to the auth routes. */
export const REFRESH_TOKEN_COOKIE = '__Secure-argent_rt';

/** NFR-05 and R-19/R-20: unreadable from JavaScript, HTTPS only, never sent cross-site. */
const BASE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'strict' };

export const ACCESS_TOKEN_COOKIE_OPTIONS: CookieOptions = { ...BASE_OPTIONS, path: '/' };
export const REFRESH_TOKEN_COOKIE_OPTIONS: CookieOptions = { ...BASE_OPTIONS, path: '/auth' };

/** Binds a Google sign-in to the browser that started it (login CSRF, threat R-27). */
export const OAUTH_BINDING_COOKIE = '__Secure-argent_oauth';
/**
 * The only `Lax` cookie: Google's redirect back is a cross-site top-level navigation, which does
 * not carry `Strict` cookies. It holds a random value whose hash must match the stored state.
 */
export const OAUTH_BINDING_COOKIE_OPTIONS: CookieOptions = {
  ...BASE_OPTIONS,
  sameSite: 'lax',
  path: '/auth/google',
};

/**
 * Binds a sign-in waiting for its second factor to the browser that passed the first one (threat
 * R-43). `Strict`, and sent only to `/auth/2fa`, where the verify route reads it.
 */
export const SIGN_IN_CHALLENGE_COOKIE = '__Secure-argent_mfa';
export const SIGN_IN_CHALLENGE_COOKIE_OPTIONS: CookieOptions = {
  ...BASE_OPTIONS,
  path: '/auth/2fa',
};

/** Lives as long as the challenge it carries. */
export function setSignInChallengeCookie<TBody>(res: ResponseFacade<TBody>, token: string): void {
  res.cookie(SIGN_IN_CHALLENGE_COOKIE, token, {
    ...SIGN_IN_CHALLENGE_COOKIE_OPTIONS,
    maxAge: SIGN_IN_CHALLENGE_TTL_MS,
  });
}

export function clearSignInChallengeCookie<TBody>(res: ResponseFacade<TBody>): void {
  res.clearCookie(SIGN_IN_CHALLENGE_COOKIE, SIGN_IN_CHALLENGE_COOKIE_OPTIONS);
}

/**
 * Carries the single-use grant a Google re-authentication earned for deleting the account.
 * `Strict` (the web app is its only sender) and sent only to `/profile/delete`, where it is read.
 */
export const DELETION_GRANT_COOKIE = '__Secure-argent_del';
export const DELETION_GRANT_COOKIE_OPTIONS: CookieOptions = {
  ...BASE_OPTIONS,
  path: '/profile/delete',
};

/** Lives as long as the grant it carries. */
export function setDeletionGrantCookie<TBody>(res: ResponseFacade<TBody>, token: string): void {
  res.cookie(DELETION_GRANT_COOKIE, token, {
    ...DELETION_GRANT_COOKIE_OPTIONS,
    maxAge: DELETION_GRANT_TTL_MS,
  });
}

export function clearDeletionGrantCookie<TBody>(res: ResponseFacade<TBody>): void {
  res.clearCookie(DELETION_GRANT_COOKIE, DELETION_GRANT_COOKIE_OPTIONS);
}

export function setSessionCookies<TBody>(res: ResponseFacade<TBody>, tokens: SessionTokens): void {
  res
    .cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
      ...ACCESS_TOKEN_COOKIE_OPTIONS,
      maxAge: tokens.accessTokenTtlSeconds * 1000,
    })
    // The cookie lasts as long as the idle limit; every rotation renews it.
    .cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      ...REFRESH_TOKEN_COOKIE_OPTIONS,
      maxAge: SESSION_IDLE_LIMIT_MS,
    });
}

/** A cookie is only cleared when name, path and attributes match the ones it was set with. */
export function clearSessionCookies<TBody>(res: ResponseFacade<TBody>): void {
  res
    .clearCookie(ACCESS_TOKEN_COOKIE, ACCESS_TOKEN_COOKIE_OPTIONS)
    .clearCookie(REFRESH_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE_OPTIONS);
}
