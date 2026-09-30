import { googleCallbackQuerySchema, googleStartQuerySchema } from '@argent/shared';
import { Router } from 'express';
import { validate } from '../../../shared/http/validate';
import type { Logger } from '../../../shared/logging/logger';
import type { CompleteGoogleSignIn } from '../../application/complete-google-sign-in';
import { OAUTH_STATE_TTL_MS, type StartGoogleSignIn } from '../../application/start-google-sign-in';
import { DEFAULT_LANGUAGE, type Language } from '../../domain/account-defaults';
import { GOOGLE_CALLBACK_PATH } from '../security/google-oidc-identity-provider';
import {
  OAUTH_BINDING_COOKIE,
  OAUTH_BINDING_COOKIE_OPTIONS,
  setSessionCookies,
} from './session-cookies';

export interface GoogleRoutesDependencies {
  startGoogleSignIn: StartGoogleSignIn;
  completeGoogleSignIn: CompleteGoogleSignIn;
  /** Every redirect back to the web app is built from here, never from a query value (R-30). */
  webBaseUrl: string;
  logger: Logger;
}

/**
 * `GET /auth/google/start` and `GET /auth/google/callback`. Both are top-level navigations, so
 * every outcome is a redirect; failures all look the same to the browser (R-29). Logs carry the
 * user id and the failure reason, never the code, state, binding, tokens or email.
 */
export function createGoogleRoutes({
  startGoogleSignIn,
  completeGoogleSignIn,
  webBaseUrl,
  logger,
}: GoogleRoutesDependencies): Router {
  const router = Router();
  const base = webBaseUrl.replace(/\/+$/, '');
  const failureUrl = (language: Language) => `${base}/${language}/sign-in?error=google_failed`;

  router.get(
    '/auth/google/start',
    validate({ query: googleStartQuerySchema }, async ({ query }, { res, ip, requestId }) => {
      const result = await startGoogleSignIn.execute({ ...query, ip });
      if (result.outcome === 'failed') {
        logger.warn({ requestId, ip, reason: result.reason }, 'google sign-in start refused');
        res.redirect(failureUrl(result.language));
        return;
      }
      logger.info({ requestId, ip }, 'google sign-in started');
      res.cookie(OAUTH_BINDING_COOKIE, result.binding, {
        ...OAUTH_BINDING_COOKIE_OPTIONS,
        maxAge: OAUTH_STATE_TTL_MS,
      });
      res.redirect(result.authorizationUrl);
    }),
  );

  router.get(
    GOOGLE_CALLBACK_PATH,
    validate(
      { query: googleCallbackQuerySchema },
      async ({ query }, { res, cookies, ip, requestId }) => {
        // Single use whatever the outcome, an unexpected fault included: cleared before any work.
        res.clearCookie(OAUTH_BINDING_COOKIE, OAUTH_BINDING_COOKIE_OPTIONS);
        const result = await completeGoogleSignIn.execute({
          params: query,
          binding: cookies[OAUTH_BINDING_COOKIE],
        });
        if (result.outcome === 'failed') {
          logger.warn({ requestId, ip, reason: result.reason }, 'google sign-in failed');
          res.redirect(failureUrl(result.language ?? DEFAULT_LANGUAGE));
          return;
        }
        const { user, session, via } = result;
        logger.info(
          { requestId, ip, userId: user.id, sessionId: session.sessionId, via },
          'google sign-in succeeded',
        );
        setSessionCookies(res, session);
        res.redirect(`${base}/${user.language}`);
      },
    ),
  );

  return router;
}
