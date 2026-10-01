import {
  emptyRequestSchema,
  refreshResponseSchema,
  sessionResponseSchema,
  signInRequestSchema,
  signInResponseSchema,
} from '@pesly/shared';
import { Router, type RequestHandler } from 'express';
import { validate } from '../../../shared/http/validate';
import type { Logger } from '../../../shared/logging/logger';
import type { GetCurrentSession } from '../../application/get-current-session';
import type { RefreshSession } from '../../application/refresh-session';
import type { SignIn } from '../../application/sign-in';
import type { SignOut } from '../../application/sign-out';
import type { SignOutAll } from '../../application/sign-out-all';
import { InvalidCredentials, Unauthenticated } from '../../domain/errors';
import {
  ACCESS_TOKEN_COOKIE,
  clearSessionCookies,
  REFRESH_TOKEN_COOKIE,
  setSessionCookies,
  setSignInChallengeCookie,
} from './session-cookies';
import { signedInUser } from './signed-in-user';

export interface SessionRoutesDependencies {
  signIn: SignIn;
  refreshSession: RefreshSession;
  signOut: SignOut;
  signOutAll: SignOutAll;
  getCurrentSession: GetCurrentSession;
  requireSession: RequestHandler;
  logger: Logger;
}

/**
 * `POST /auth/sign-in`, `/auth/refresh`, `/auth/sign-out`, `/auth/sign-out-all` and
 * `GET /auth/session`. Tokens travel only in HttpOnly cookies; every outcome is logged with user
 * id, session id and IP (never the email or a token).
 */
export function createSessionRoutes({
  signIn,
  refreshSession,
  signOut,
  signOutAll,
  getCurrentSession,
  requireSession,
  logger,
}: SessionRoutesDependencies): Router {
  const router = Router();

  router.post(
    '/auth/sign-in',
    validate(
      { body: signInRequestSchema, response: signInResponseSchema },
      async ({ body }, { res, ip, requestId }) => {
        const result = await signIn.execute({ ...body, ip });
        if (result.outcome === 'invalid_credentials') {
          logger.info({ requestId, ip, userId: result.userId ?? undefined }, 'sign-in failed');
          // Same status and body for an unknown email and a wrong password (R-02).
          throw new InvalidCredentials();
        }
        if (result.outcome === 'second_factor_required') {
          logger.info({ requestId, ip, userId: result.user.id }, 'sign-in needs a second factor');
          setSignInChallengeCookie(res, result.challengeToken);
          res.status(200).json({ status: 'second_factor_required' });
          return;
        }
        const { user, session } = result;
        logger.info(
          { requestId, ip, userId: user.id, sessionId: session.sessionId },
          'sign-in succeeded',
        );
        setSessionCookies(res, session);
        res.status(200).json({ status: 'signed_in', user: signedInUser(user) });
      },
    ),
  );

  router.post(
    '/auth/refresh',
    validate(
      { body: emptyRequestSchema, response: refreshResponseSchema },
      async (_input, { res, cookies, ip, requestId }) => {
        const result = await refreshSession.execute(cookies[REFRESH_TOKEN_COOKIE]);
        // A refused refresh leaves no dead session cookie behind; the error body follows.
        if (result.outcome !== 'rotated') clearSessionCookies(res);
        if (result.outcome === 'reused') {
          logger.warn(
            { requestId, ip, userId: result.userId, familyId: result.familyId },
            'refresh token reused; session family revoked',
          );
          throw new Unauthenticated();
        }
        if (result.outcome === 'rejected') {
          logger.info({ requestId, ip }, 'refresh rejected');
          throw new Unauthenticated();
        }
        logger.info(
          {
            requestId,
            ip,
            userId: result.userId,
            previousSessionId: result.previousSessionId,
            sessionId: result.session.sessionId,
          },
          'session refreshed',
        );
        setSessionCookies(res, result.session);
        res.status(200).json({ status: 'refreshed' });
      },
    ),
  );

  router.post(
    '/auth/sign-out',
    validate({ body: emptyRequestSchema }, async (_input, { res, cookies, ip, requestId }) => {
      const result = await signOut.execute({
        accessToken: cookies[ACCESS_TOKEN_COOKIE],
        refreshToken: cookies[REFRESH_TOKEN_COOKIE],
      });
      logger.info(
        { requestId, ip, userId: result.userId ?? undefined, sessionIds: result.sessionIds },
        'signed out',
      );
      clearSessionCookies(res);
      res.status(204).end();
    }),
  );

  router.post(
    '/auth/sign-out-all',
    requireSession,
    validate({ body: emptyRequestSchema }, async (_input, { res, auth, ip, requestId }) => {
      // requireSession guarantees it; checked again so a missing middleware fails closed.
      if (!auth) throw new Unauthenticated();
      await signOutAll.execute(auth.userId);
      logger.info({ requestId, ip, userId: auth.userId }, 'signed out everywhere');
      clearSessionCookies(res);
      res.status(204).end();
    }),
  );

  router.get(
    '/auth/session',
    validate({ response: sessionResponseSchema }, async (_input, { res, cookies }) => {
      // Authenticates like requireSession does, and needs the user it loads.
      const current = await getCurrentSession.execute(cookies[ACCESS_TOKEN_COOKIE]);
      if (!current) throw new Unauthenticated();
      const { user } = current;
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          emailVerified: user.emailVerifiedAt !== null,
          language: user.language,
          timeZone: user.timeZone,
        },
      });
    }),
  );

  return router;
}
