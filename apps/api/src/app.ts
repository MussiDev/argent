import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type RequestHandler, type Router } from 'express';
import helmet from 'helmet';
import {
  createIdentityRouters,
  type BreachedPasswordChecker,
  type Clock,
  type IdentityDb,
} from './identity';
import type { Env } from './shared/config/env';
import { createErrorHandler, HttpError } from './shared/http/error-handler';
import { healthRoutes } from './shared/http/health-routes';
import { createOriginGuard } from './shared/http/origin-guard';
import type { Logger } from './shared/logging/logger';

export const JSON_BODY_LIMIT = '16kb';

export interface IdentityModuleOptions {
  db: IdentityDb;
  clock?: Clock;
  /**
   * Session middleware for authenticated identity routes. Defaults to one that rejects every
   * request with 401 until Block 4 provides the real `requireSession` (fail closed).
   */
  requireSession?: RequestHandler;
  /** Test seam: replaces the breach checker selected by `BREACH_CHECKER`. */
  breachedPasswordChecker?: BreachedPasswordChecker;
}

export interface AppDependencies {
  env: Env;
  logger: Logger;
  /** When given, the identity module's routes are mounted. */
  identity?: IdentityModuleOptions;
  /** Module routers, mounted after the cross-cutting middleware and before the error handler. */
  routers?: Router[];
}

const rejectWithoutSession: RequestHandler = (_req, _res, next) => {
  next(new HttpError(401, 'UNAUTHENTICATED'));
};

function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => {
      logger.info(
        {
          requestId,
          method: req.method,
          route: req.originalUrl.split('?')[0],
          status: res.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
        },
        'request completed',
      );
    });
    next();
  };
}

/**
 * TLS ends at the hosting edge; in production any request the edge did not receive over HTTPS is
 * refused (NFR-07). `req.secure` only honours X-Forwarded-Proto from the trusted proxy hops
 * configured in TRUST_PROXY, so a client cannot claim https by sending the header itself.
 */
function httpsGuard(env: Env): RequestHandler {
  return (req, _res, next) => {
    if (env.NODE_ENV !== 'production' || req.secure) {
      next();
      return;
    }
    next(new HttpError(400, 'VALIDATION_FAILED'));
  };
}

export function createApp({ env, logger, identity, routers = [] }: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestContext(logger));
  app.use(helmet());
  app.use(cors({ origin: [env.WEB_ORIGIN], credentials: true }));
  // Before the HTTPS guard: platform health probes call it over plain HTTP inside the network.
  app.use(healthRoutes());
  app.use(httpsGuard(env));
  app.use(createOriginGuard(env.WEB_ORIGIN));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(cookieParser());

  if (identity) {
    const identityRouters = createIdentityRouters({
      db: identity.db,
      env,
      logger,
      ...(identity.clock ? { clock: identity.clock } : {}),
      requireSession: identity.requireSession ?? rejectWithoutSession,
      breachedPasswordChecker: identity.breachedPasswordChecker,
    });
    for (const router of identityRouters) app.use(router);
  }
  for (const router of routers) app.use(router);

  app.use((_req, _res, next) => {
    next(new HttpError(404, 'NOT_FOUND'));
  });
  app.use(createErrorHandler(logger));

  return app;
}
