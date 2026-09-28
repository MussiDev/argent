import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../src/app';
import type { Env } from '../../src/shared/config/env';
import { REQUIRED_REQUESTED_WITH } from '../../src/shared/http/origin-guard';
import { validate } from '../../src/shared/http/validate';
import { createLogger } from '../../src/shared/logging/logger';
import { productionEnv, testEnv, trustedHeaders, WEB_ORIGIN } from '../helpers/test-env';

function buildApp(env: Env = testEnv()) {
  const router = Router();
  router.post(
    '/items',
    validate({ body: z.object({ text: z.string() }) }, (_input, { res }) => {
      res.status(201).json({ status: 'created' });
    }),
  );
  router.get('/items', (_req, res) => {
    res.json({ items: [] });
  });
  return createApp({ env, logger: createLogger({ level: 'silent' }), routers: [router] });
}

describe('body size limit (R-12)', () => {
  it('returns 413 VALIDATION_FAILED for a JSON body over 16 KB', async () => {
    const response = await request(buildApp())
      .post('/items')
      .set(trustedHeaders)
      .send({ text: 'x'.repeat(17 * 1024) });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ code: 'VALIDATION_FAILED' });
  });

  it('accepts a JSON body under 16 KB', async () => {
    const response = await request(buildApp())
      .post('/items')
      .set(trustedHeaders)
      .send({ text: 'x'.repeat(15 * 1024) });

    expect(response.status).toBe(201);
  });
});

describe('origin guard (R-19)', () => {
  it('returns 403 VALIDATION_FAILED for a POST without Origin', async () => {
    const response = await request(buildApp())
      .post('/items')
      .set('X-Requested-With', REQUIRED_REQUESTED_WITH)
      .send({ text: 'hi' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'VALIDATION_FAILED' });
  });

  it('returns 403 VALIDATION_FAILED for a POST from another origin', async () => {
    const response = await request(buildApp())
      .post('/items')
      .set({ Origin: 'https://evil.example', 'X-Requested-With': REQUIRED_REQUESTED_WITH })
      .send({ text: 'hi' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'VALIDATION_FAILED' });
  });

  it('returns 403 VALIDATION_FAILED for a POST from the web origin without X-Requested-With', async () => {
    const response = await request(buildApp())
      .post('/items')
      .set('Origin', WEB_ORIGIN)
      .send({ text: 'hi' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'VALIDATION_FAILED' });
  });

  it('lets through a POST from the web origin with X-Requested-With', async () => {
    const response = await request(buildApp())
      .post('/items')
      .set(trustedHeaders)
      .send({ text: 'hi' });

    expect(response.status).toBe(201);
  });

  it('allows credentialed CORS only for the web origin', async () => {
    const allowed = await request(buildApp()).get('/health').set('Origin', WEB_ORIGIN);
    const denied = await request(buildApp()).get('/health').set('Origin', 'https://evil.example');

    expect(allowed.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('HTTPS guard and HSTS (NFR-07)', () => {
  it('returns 400 VALIDATION_FAILED in production when the trusted proxy forwarded plain http, with HSTS', async () => {
    const response = await request(buildApp(productionEnv()))
      .get('/items')
      .set('X-Forwarded-Proto', 'http');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'VALIDATION_FAILED' });
    expect(response.headers['strict-transport-security']).toMatch(/max-age=\d+/);
  });

  it('serves production requests the trusted proxy received over https, with HSTS', async () => {
    const response = await request(buildApp(productionEnv()))
      .get('/items')
      .set('X-Forwarded-Proto', 'https');

    expect(response.status).toBe(200);
    expect(response.headers['strict-transport-security']).toMatch(/max-age=\d+/);
  });

  it('ignores X-Forwarded-Proto when the proxy is not trusted', async () => {
    const env = { ...productionEnv(), TRUST_PROXY: 0 };
    const response = await request(buildApp(env)).get('/items').set('X-Forwarded-Proto', 'https');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'VALIDATION_FAILED' });
  });

  it('answers /health over plain http in production for platform probes', async () => {
    const response = await request(buildApp(productionEnv())).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('still rejects other routes over plain http in production', async () => {
    const response = await request(buildApp(productionEnv())).get('/items');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'VALIDATION_FAILED' });
  });

  it('does not require https outside production', async () => {
    const response = await request(buildApp()).get('/items');

    expect(response.status).toBe(200);
  });
});
