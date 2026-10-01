import {
  emptyRequestSchema,
  twoFactorDisableRequestSchema,
  twoFactorEnableRequestSchema,
  twoFactorEnableResponseSchema,
  twoFactorSetupResponseSchema,
  twoFactorStatusResponseSchema,
} from '@argent/shared';
import { Router, type RequestHandler } from 'express';
import { requireVerifiedEmail } from '../../../shared/http/require-verified-email';
import { validate } from '../../../shared/http/validate';
import type { Logger } from '../../../shared/logging/logger';
import type { DisableTwoFactor } from '../../application/disable-two-factor';
import type { EnableTwoFactor } from '../../application/enable-two-factor';
import type { GetTwoFactorStatus } from '../../application/get-two-factor-status';
import type { StartTwoFactorSetup } from '../../application/start-two-factor-setup';
import { TotpInvalid, Unauthenticated } from '../../domain/errors';
import { setSessionCookies } from './session-cookies';

export interface TwoFactorRoutesDependencies {
  getTwoFactorStatus: GetTwoFactorStatus;
  startTwoFactorSetup: StartTwoFactorSetup;
  enableTwoFactor: EnableTwoFactor;
  disableTwoFactor: DisableTwoFactor;
  requireSession: RequestHandler;
  logger: Logger;
}

/**
 * `GET /auth/2fa` and `POST /auth/2fa/setup`, `/enable` and `/disable`, for signed-in users with a
 * verified email. Outcomes are logged with user id and session id, never with a code, secret or
 * recovery code; responses that carry a secret are never cached (threat R-49).
 */
export function createTwoFactorRoutes({
  getTwoFactorStatus,
  startTwoFactorSetup,
  enableTwoFactor,
  disableTwoFactor,
  requireSession,
  logger,
}: TwoFactorRoutesDependencies): Router {
  const router = Router();
  const guards = [requireSession, requireVerifiedEmail];

  router.get(
    '/auth/2fa',
    ...guards,
    validate({ response: twoFactorStatusResponseSchema }, async (_input, { res, auth }) => {
      // The guards guarantee it; checked again so a missing middleware fails closed.
      if (!auth) throw new Unauthenticated();
      res.status(200).json(await getTwoFactorStatus.execute(auth.userId));
    }),
  );

  router.post(
    '/auth/2fa/setup',
    ...guards,
    validate(
      { body: emptyRequestSchema, response: twoFactorSetupResponseSchema },
      async (_input, { res, auth, ip, requestId }) => {
        if (!auth) throw new Unauthenticated();
        const setup = await startTwoFactorSetup.execute(auth.userId);
        logger.info(
          { requestId, ip, userId: auth.userId, sessionId: auth.sessionId },
          'two-factor setup started',
        );
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(setup);
      },
    ),
  );

  router.post(
    '/auth/2fa/enable',
    ...guards,
    validate(
      { body: twoFactorEnableRequestSchema, response: twoFactorEnableResponseSchema },
      async ({ body }, { res, auth, ip, requestId }) => {
        if (!auth) throw new Unauthenticated();
        const context = { requestId, ip, userId: auth.userId, sessionId: auth.sessionId };
        const result = await enableTwoFactor
          .execute({ userId: auth.userId, code: body.code })
          .catch((error: unknown) => {
            if (error instanceof TotpInvalid) logger.info(context, 'two-factor enable refused');
            throw error;
          });
        const { recoveryCodes, session } = result;
        logger.info({ ...context, newSessionId: session?.sessionId ?? null }, 'two-factor enabled');
        res.setHeader('Cache-Control', 'no-store');
        // Without a new session the user signs in again; the codes are shown either way.
        if (session) setSessionCookies(res, session);
        res.status(200).json({ recoveryCodes });
      },
    ),
  );

  router.post(
    '/auth/2fa/disable',
    ...guards,
    validate(
      { body: twoFactorDisableRequestSchema },
      async ({ body }, { res, auth, ip, requestId }) => {
        if (!auth) throw new Unauthenticated();
        const context = { requestId, ip, userId: auth.userId, sessionId: auth.sessionId };
        const result = await disableTwoFactor
          .execute({ userId: auth.userId, code: body.code })
          .catch((error: unknown) => {
            if (error instanceof TotpInvalid) logger.info(context, 'two-factor disable refused');
            throw error;
          });
        logger.info(
          { ...context, newSessionId: result.session?.sessionId ?? null },
          'two-factor disabled',
        );
        if (result.session) setSessionCookies(res, result.session);
        res.status(204).end();
      },
    ),
  );

  return router;
}
