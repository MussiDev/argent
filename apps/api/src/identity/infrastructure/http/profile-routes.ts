import {
  deleteUserRequestSchema,
  emptyRequestSchema,
  profileResponseSchema,
  startDeletionReauthResponseSchema,
  updateProfileRequestSchema,
} from '@pesly/shared';
import { Router, type RequestHandler } from 'express';
import { validate } from '../../../shared/http/validate';
import type { Logger } from '../../../shared/logging/logger';
import type { DeleteUser } from '../../application/delete-user';
import type { GetProfile } from '../../application/get-profile';
import { OAUTH_STATE_TTL_MS } from '../../application/start-google-sign-in';
import type { StartDeletionReauth } from '../../application/start-deletion-reauth';
import type { UpdateProfile } from '../../application/update-profile';
import { Unauthenticated } from '../../domain/errors';
import {
  clearDeletionGrantCookie,
  clearSessionCookies,
  DELETION_GRANT_COOKIE,
  OAUTH_BINDING_COOKIE,
  OAUTH_BINDING_COOKIE_OPTIONS,
} from './session-cookies';

export interface ProfileRoutesDependencies {
  getProfile: GetProfile;
  updateProfile: UpdateProfile;
  deleteUser: DeleteUser;
  startDeletionReauth: StartDeletionReauth;
  requireSession: RequestHandler;
  logger: Logger;
}

const CHANGEABLE_FIELDS = [
  'displayName',
  'defaultRateType',
  'displayCurrency',
  'timeZone',
  'language',
] as const;

/**
 * `GET /profile`, `PATCH /profile`, `POST /profile/delete` and `POST /profile/delete/google/start`
 * for signed-in users. The user id
 * comes only from the session; outcomes are logged with the names of the changed fields, never
 * their values, because a display name and the preferences are personal data.
 */
export function createProfileRoutes({
  getProfile,
  updateProfile,
  deleteUser,
  startDeletionReauth,
  requireSession,
  logger,
}: ProfileRoutesDependencies): Router {
  const router = Router();

  router.get(
    '/profile',
    requireSession,
    validate({ response: profileResponseSchema }, async (_input, { res, auth, ip, requestId }) => {
      // The guard guarantees it; checked again so a missing middleware fails closed.
      if (!auth) throw new Unauthenticated();
      const profile = await getProfile.execute(auth.userId);
      logger.info({ requestId, ip, userId: auth.userId }, 'profile read');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(profile);
    }),
  );

  router.patch(
    '/profile',
    requireSession,
    validate(
      { body: updateProfileRequestSchema, response: profileResponseSchema },
      async ({ body }, { res, auth, ip, requestId }) => {
        if (!auth) throw new Unauthenticated();
        const profile = await updateProfile.execute(auth.userId, body);
        const fields = CHANGEABLE_FIELDS.filter((field) => body[field] !== undefined);
        logger.info({ requestId, ip, userId: auth.userId, fields }, 'profile updated');
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(profile);
      },
    ),
  );

  // Not behind `requireVerifiedEmail`: an unverified user can delete their own data.
  router.post(
    '/profile/delete',
    requireSession,
    validate(
      { body: deleteUserRequestSchema },
      async ({ body }, { res, auth, ip, requestId, cookies }) => {
        if (!auth) throw new Unauthenticated();
        await deleteUser.execute({
          userId: auth.userId,
          sessionId: auth.sessionId,
          password: body.password,
          secondFactorCode: body.secondFactorCode,
          grantToken: cookies[DELETION_GRANT_COOKIE],
          ip,
        });
        // Ids only: the email, the password, the code and the grant are never logged.
        logger.info(
          { requestId, ip, userId: auth.userId, sessionId: auth.sessionId },
          'account deleted',
        );
        clearSessionCookies(res);
        clearDeletionGrantCookie(res);
        res.status(204).end();
      },
    ),
  );

  // The grant cookie, if sent, is not read: this only starts a re-authentication. The callback
  // (`/auth/google/callback`) completes it. Never logs the authorization URL or the binding.
  router.post(
    '/profile/delete/google/start',
    requireSession,
    validate(
      { body: emptyRequestSchema, response: startDeletionReauthResponseSchema },
      async (_input, { res, auth, ip, requestId }) => {
        if (!auth) throw new Unauthenticated();
        const { authorizationUrl, binding } = await startDeletionReauth.execute({
          userId: auth.userId,
          sessionId: auth.sessionId,
          ip,
        });
        logger.info(
          { requestId, ip, userId: auth.userId, sessionId: auth.sessionId },
          'deletion re-authentication started',
        );
        res.cookie(OAUTH_BINDING_COOKIE, binding, {
          ...OAUTH_BINDING_COOKIE_OPTIONS,
          maxAge: OAUTH_STATE_TTL_MS,
        });
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({ authorizationUrl });
      },
    ),
  );

  return router;
}
