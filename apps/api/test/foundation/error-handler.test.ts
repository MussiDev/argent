import { AppError } from '@argent/shared';
import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { createLogger } from '../../src/shared/logging/logger';
import type { Env } from '../../src/shared/config/env';
import { productionEnv, testEnv } from '../helpers/test-env';

function buildApp(env: Env, lines: string[] = []) {
  const router = Router();
  router.get('/boom', () => {
    throw new Error('relation "users" does not exist at SELECT * FROM users');
  });
  router.get('/async-boom', async () => {
    await Promise.resolve();
    throw new Error('async failure with SQL detail');
  });
  router.get('/too-short', async () => {
    await Promise.resolve();
    throw new AppError('PASSWORD_TOO_SHORT');
  });
  router.get('/name-taken', () => {
    throw new AppError('ACCOUNT_NAME_TAKEN');
  });
  router.get('/has-movements', () => {
    throw new AppError('ACCOUNT_HAS_MOVEMENTS');
  });
  const logger = createLogger({
    level: 'info',
    destination: { write: (line: string) => lines.push(line) },
  });
  return createApp({ env, logger, routers: [router] });
}

describe('error handler', () => {
  it('returns 500 INTERNAL without stack or SQL message in production and logs the request id', async () => {
    const lines: string[] = [];
    const response = await request(buildApp(productionEnv(), lines))
      .get('/boom')
      .set('X-Forwarded-Proto', 'https');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: 'INTERNAL' });
    expect(response.text).not.toContain('SELECT');
    expect(response.text).not.toContain('at ');

    const requestId = response.headers['x-request-id'];
    expect(requestId).toEqual(expect.any(String));
    const errorLine = lines.find((line) => line.includes('"code":"INTERNAL"'));
    expect(errorLine).toBeDefined();
    expect(errorLine).toContain(`"requestId":"${String(requestId)}"`);
  });

  it('routes rejected promises from async handlers to the error handler', async () => {
    const response = await request(buildApp(productionEnv()))
      .get('/async-boom')
      .set('X-Forwarded-Proto', 'https');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: 'INTERNAL' });
  });

  it('maps a known application error (PASSWORD_TOO_SHORT) to 400 with its code', async () => {
    const response = await request(buildApp(testEnv())).get('/too-short');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'PASSWORD_TOO_SHORT' });
  });

  it('maps ACCOUNT_NAME_TAKEN to 409 with only its code', async () => {
    const response = await request(buildApp(testEnv())).get('/name-taken');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'ACCOUNT_NAME_TAKEN' });
  });

  it('maps ACCOUNT_HAS_MOVEMENTS to 409 with only its code', async () => {
    const response = await request(buildApp(testEnv())).get('/has-movements');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'ACCOUNT_HAS_MOVEMENTS' });
  });

  it('answers unknown routes with 404 NOT_FOUND', async () => {
    const response = await request(buildApp(testEnv())).get('/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: 'NOT_FOUND' });
  });
});
