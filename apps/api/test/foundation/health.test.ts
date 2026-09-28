import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { createLogger } from '../../src/shared/logging/logger';
import { testEnv } from '../helpers/test-env';

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = createApp({ env: testEnv(), logger: createLogger({ level: 'silent' }) });

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
