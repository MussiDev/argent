import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../src/app';
import { validate } from '../../src/shared/http/validate';
import { createLogger } from '../../src/shared/logging/logger';
import { testEnv, trustedHeaders } from '../helpers/test-env';

const bodySchema = z.object({
  name: z.string().min(1),
  age: z.number().int(),
});
const querySchema = z.object({ page: z.coerce.number().int().positive() });

function buildApp() {
  const router = Router();
  router.post(
    '/echo',
    validate({ body: bodySchema, query: querySchema }, ({ body, query }, { res }) => {
      res.json({ body, query });
    }),
  );
  router.post(
    '/context',
    validate({ body: bodySchema }, (input, context) => {
      context.res.json({ body: input.body, contextKeys: Object.keys(context).sort() });
    }),
  );
  router.post(
    '/context-details',
    validate({ body: bodySchema }, (_input, context) => {
      context.res.json({
        resHasReq: 'req' in context.res,
        resKeys: Object.keys(context.res).sort(),
        cookies: context.cookies,
      });
    }),
  );
  return createApp({
    env: testEnv(),
    logger: createLogger({ level: 'silent' }),
    routers: [router],
  });
}

describe('validation middleware', () => {
  it('returns 400 VALIDATION_FAILED with the failing field paths and no echoed values', async () => {
    const response = await request(buildApp())
      .post('/echo?page=zero')
      .set(trustedHeaders)
      .send({ name: '', age: 'not-a-number-secret-value' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: 'VALIDATION_FAILED',
      fields: expect.arrayContaining(['body.name', 'body.age', 'query.page']) as unknown,
    });
    expect(response.text).not.toContain('not-a-number-secret-value');
  });

  it('strips unknown keys before the handler sees the input', async () => {
    const response = await request(buildApp())
      .post('/echo?page=2&debug=1')
      .set(trustedHeaders)
      .send({ name: 'Ana', age: 30, emailVerifiedAt: '2026-01-01T00:00:00Z' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ body: { name: 'Ana', age: 30 }, query: { page: 2 } });
  });

  it('gives the handler no access to the raw request, so unknown body keys are unreachable', async () => {
    const response = await request(buildApp())
      .post('/context')
      .set(trustedHeaders)
      .send({ name: 'Ana', age: 30, isAdmin: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      body: { name: 'Ana', age: 30 },
      contextKeys: ['cookies', 'ip', 'requestId', 'res'],
    });
    expect(response.text).not.toContain('isAdmin');
  });

  it('exposes only a narrow response facade, with no path back to the raw request', async () => {
    const response = await request(buildApp())
      .post('/context-details')
      .set(trustedHeaders)
      .send({ name: 'Ana', age: 30 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      resHasReq: false,
      resKeys: ['clearCookie', 'cookie', 'end', 'json', 'sendStatus', 'setHeader', 'status'],
    });
  });

  it('keeps only string-valued cookies (cookie-parser turns j: cookies into objects)', async () => {
    const response = await request(buildApp())
      .post('/context-details')
      .set(trustedHeaders)
      .set('Cookie', ['plain=abc', `object=${encodeURIComponent('j:{"admin":true}')}`])
      .send({ name: 'Ana', age: 30 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ cookies: { plain: 'abc' } });
    expect(Object.keys((response.body as { cookies: object }).cookies)).toEqual(['plain']);
  });

  it('accepts only stripping object schemas (compile-time)', () => {
    const handler = () => undefined;
    // @ts-expect-error a non-object body schema cannot strip unknown keys
    validate({ body: z.string() }, handler);
    // @ts-expect-error a loose object schema keeps unknown keys
    validate({ body: z.looseObject({ name: z.string() }) }, handler);
    // @ts-expect-error a passthrough-like record keeps every key
    validate({ query: z.record(z.string(), z.string()) }, handler);
    expect(typeof validate({ body: bodySchema }, handler)).toBe('function');
  });

  it('returns 400 VALIDATION_FAILED for malformed JSON', async () => {
    const response = await request(buildApp())
      .post('/echo?page=1')
      .set(trustedHeaders)
      .set('Content-Type', 'application/json')
      .send('{"name":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'VALIDATION_FAILED' });
  });
});
