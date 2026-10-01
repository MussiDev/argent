import { profileResponseSchema, updateProfileRequestSchema } from '@argent/shared';
import { Router, type RequestHandler } from 'express';
import { validate } from '../../../shared/http/validate';
import type { Logger } from '../../../shared/logging/logger';
import type { GetProfile } from '../../application/get-profile';
import type { UpdateProfile } from '../../application/update-profile';
import { Unauthenticated } from '../../domain/errors';

export interface ProfileRoutesDependencies {
  getProfile: GetProfile;
  updateProfile: UpdateProfile;
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
 * `GET /profile` and `PATCH /profile` for signed-in users. The user id comes only from the
 * session; outcomes are logged with the names of the changed fields, never their values, because
 * a display name and the preferences are personal data.
 */
export function createProfileRoutes({
  getProfile,
  updateProfile,
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

  return router;
}
