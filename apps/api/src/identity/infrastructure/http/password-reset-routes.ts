import {
  passwordResetConfirmRequestSchema,
  passwordResetConfirmResponseSchema,
  passwordResetRequestSchema,
  passwordResetResponseSchema,
} from '@pesly/shared';
import { Router } from 'express';
import { validate } from '../../../shared/http/validate';
import type { Logger } from '../../../shared/logging/logger';
import type { ConfirmPasswordReset } from '../../application/confirm-password-reset';
import type { RequestPasswordReset } from '../../application/request-password-reset';

export interface PasswordResetRoutesDependencies {
  requestPasswordReset: RequestPasswordReset;
  confirmPasswordReset: ConfirmPasswordReset;
  logger: Logger;
}

/**
 * `POST /auth/password-reset/request` and `POST /auth/password-reset/confirm`. Tokens travel only
 * in request bodies: request paths are logged, bodies never are. Requests and completions are
 * logged with account id and IP, never the email, the token or the password.
 */
export function createPasswordResetRoutes({
  requestPasswordReset,
  confirmPasswordReset,
  logger,
}: PasswordResetRoutesDependencies): Router {
  const router = Router();

  router.post(
    '/auth/password-reset/request',
    validate(
      { body: passwordResetRequestSchema, response: passwordResetResponseSchema },
      async ({ body }, { res, ip, requestId }) => {
        const result = await requestPasswordReset.execute({ email: body.email, ip });
        logger.info(
          {
            requestId,
            ip,
            outcome: result.outcome,
            userId: result.outcome === 'enqueued' ? result.userId : undefined,
          },
          'password reset requested',
        );
        // Same status and body whether or not the email is registered (R-02).
        res.status(202).json({ status: 'reset_sent_if_registered' });
      },
    ),
  );

  router.post(
    '/auth/password-reset/confirm',
    validate(
      { body: passwordResetConfirmRequestSchema, response: passwordResetConfirmResponseSchema },
      async ({ body }, { res, ip, requestId }) => {
        const { userId } = await confirmPasswordReset.execute(body);
        logger.info({ requestId, ip, userId }, 'password reset');
        res.status(200).json({ status: 'password_updated' });
      },
    ),
  );

  return router;
}
