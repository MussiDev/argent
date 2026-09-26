import type { RequestHandler } from 'express';
import type { AuthContext } from './auth-context';
import { HttpError } from './error-handler';

/**
 * Resolves who an access token authenticates, or null. The identity module provides it: it
 * verifies the JWT and checks that the session row is live and the user exists.
 */
export type SessionAuthenticator = (accessToken: string) => Promise<AuthContext | null>;

export interface RequireSessionOptions {
  /** Name of the cookie that carries the access token. */
  cookieName: string;
  authenticate: SessionAuthenticator;
}

/**
 * Builds `requireSession`, the middleware every authenticated route of every module mounts first.
 * It reads the access-token cookie, authenticates it on every request (a revoked session stops
 * working at once, threat R-16) and sets `req.auth`; anything else answers 401 `UNAUTHENTICATED`.
 * Handlers take the user id from `auth`, never from the request body or query.
 *
 * The identity module builds the instance (`createIdentityModule(...).requireSession`).
 */
export function createRequireSession({
  cookieName,
  authenticate,
}: RequireSessionOptions): RequestHandler {
  return async (req, _res, next) => {
    const cookies: unknown = req.cookies;
    const token: unknown =
      typeof cookies === 'object' && cookies !== null
        ? Reflect.get(cookies, cookieName)
        : undefined;
    const auth = typeof token === 'string' && token !== '' ? await authenticate(token) : null;
    if (!auth) {
      next(new HttpError(401, 'UNAUTHENTICATED'));
      return;
    }
    req.auth = auth;
    next();
  };
}
