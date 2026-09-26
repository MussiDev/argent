import {
  registerRequestSchema,
  registerResponseSchema,
  resendVerificationRequestSchema,
  resendVerificationResponseSchema,
  verifyEmailRequestSchema,
  verifyEmailResponseSchema,
} from '@argent/shared';
import { Router, type RequestHandler } from 'express';
import type { Logger } from '../../../shared/logging/logger';
import { validate } from '../../../shared/http/validate';
import type { RegisterUser } from '../../application/register-user';
import type { ResendVerification } from '../../application/resend-verification';
import type { VerifyEmail } from '../../application/verify-email';
import { Unauthenticated } from '../../domain/errors';

export interface RegistrationRoutesDependencies {
  registerUser: RegisterUser;
  verifyEmail: VerifyEmail;
  resendVerification: ResendVerification;
  /**
   * Authenticates the request and sets `req.auth`. Injected so this module does not depend on how
   * sessions work: Block 4 provides the real `requireSession`; tests pass a double.
   */
  requireSession: RequestHandler;
  logger: Logger;
}

/**
 * `POST /auth/register`, `POST /auth/verify-email` and `POST /auth/verification/resend`.
 * Tokens travel only in request bodies: request paths are logged, bodies never are.
 */
export function createRegistrationRoutes({
  registerUser,
  verifyEmail,
  resendVerification,
  requireSession,
  logger,
}: RegistrationRoutesDependencies): Router {
  const router = Router();

  router.post(
    '/auth/register',
    validate(
      { body: registerRequestSchema, response: registerResponseSchema },
      async ({ body }, { res, ip, requestId }) => {
        const result = await registerUser.execute({ ...body, ip });
        // Account id and IP, never the email (PII stays out of logs).
        logger.info(
          {
            requestId,
            ip,
            outcome: result.outcome,
            userId: result.outcome === 'created' ? result.userId : undefined,
          },
          'registration accepted',
        );
        // Same status and body whether or not the email was already registered (R-02).
        res.status(202).json({ status: 'verification_sent' });
      },
    ),
  );

  router.post(
    '/auth/verify-email',
    validate(
      { body: verifyEmailRequestSchema, response: verifyEmailResponseSchema },
      async ({ body }, { res, ip, requestId }) => {
        const { userId } = await verifyEmail.execute(body.token);
        logger.info({ requestId, ip, userId }, 'email verified');
        res.status(200).json({ status: 'verified' });
      },
    ),
  );

  router.post(
    '/auth/verification/resend',
    requireSession,
    validate(
      { body: resendVerificationRequestSchema, response: resendVerificationResponseSchema },
      async (_input, { res, auth, ip, requestId }) => {
        // requireSession guarantees it; checked again so a missing middleware fails closed.
        if (!auth) throw new Unauthenticated();
        const result = await resendVerification.execute(auth.userId);
        logger.info(
          { requestId, ip, userId: auth.userId, outcome: result.outcome },
          'verification resend requested',
        );
        res.status(202).json({ status: 'verification_sent' });
      },
    ),
  );

  return router;
}
