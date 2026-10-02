import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RATE_TYPES, latestRatesResponseSchema } from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExchangeRateRoutes } from '../../src/exchange-rates';
import { DrizzleRateRepository } from '../../src/exchange-rates/infrastructure/db/drizzle-rate-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createIdentityHarness } from '../helpers/identity-harness';
import {
  cookieHeader,
  seedUser,
  sessionFrom,
  signIn,
  type SessionCookies,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { ScriptedRateProvider, sampleQuotes } from './fakes';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const PASSWORD = 'a long enough passphrase';
const FETCHED_AT = new Date('2026-10-02T12:00:00.000Z');

interface Setup {
  app: Express;
  ana: SessionCookies;
}

async function setup(routeDb = connection.db): Promise<Setup> {
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [createExchangeRateRoutes({ db: routeDb })],
  });
  await seedUser(connection, { email: 'ana@example.com', password: PASSWORD });
  const ana = sessionFrom(await signIn(harness.app, 'ana@example.com', PASSWORD));
  return { app: harness.app, ana };
}

function get(app: Express, path: string, cookies?: SessionCookies) {
  const call = request(app).get(path);
  if (cookies) call.set('Cookie', cookieHeader(cookies));
  return call;
}

async function seedRates(): Promise<void> {
  const quotes = sampleQuotes().map((quote, index) =>
    index === 0 ? { ...quote, buy: 16_233_000n, sell: 16_300_500n } : quote,
  );
  await new DrizzleRateRepository(connection.db).replaceAll([...quotes].reverse(), FETCHED_AT);
}

describe('GET /exchange-rates/latest', () => {
  it('gives a verified user the 7 stored rates with scaled strings and both timestamps', async () => {
    const s = await setup();
    await seedRates();
    const response = await get(s.app, '/exchange-rates/latest', s.ana);
    expect(response.status).toBe(200);
    const body = latestRatesResponseSchema.parse(response.body);
    expect(body.rates.map((rate) => rate.rateType)).toEqual([...RATE_TYPES]);
    expect(body.rates[0]).toEqual({
      rateType: RATE_TYPES[0],
      buy: '16233000',
      sell: '16300500',
      providerUpdatedAt: '2026-10-02T11:50:00.000Z',
      fetchedAt: '2026-10-02T12:00:00.000Z',
    });
  });

  it('has no number-typed rate field in the body', async () => {
    const s = await setup();
    await seedRates();
    const response = await get(s.app, '/exchange-rates/latest', s.ana);
    const rates = (response.body as { rates: Record<string, unknown>[] }).rates;
    for (const rate of rates) {
      for (const value of Object.values(rate)) expect(typeof value).toBe('string');
    }
  });

  it('answers 200 and { rates: [] } when nothing is stored', async () => {
    const s = await setup();
    const response = await get(s.app, '/exchange-rates/latest', s.ana);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ rates: [] });
  });

  it('answers 401 UNAUTHENTICATED without a session and returns no rates', async () => {
    const s = await setup();
    await seedRates();
    const response = await get(s.app, '/exchange-rates/latest');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 'UNAUTHENTICATED' });
  });

  it('answers 403 EMAIL_NOT_VERIFIED for a session without a verified email', async () => {
    const s = await setup();
    await seedRates();
    await seedUser(connection, { email: 'eve@example.com', password: PASSWORD, verified: false });
    const eve = sessionFrom(await signIn(s.app, 'eve@example.com', PASSWORD));
    const response = await get(s.app, '/exchange-rates/latest', eve);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('answers 500 INTERNAL with only { code } when the database fails', async () => {
    const broken = createDatabase(testDatabaseUrl);
    await broken.pool.end();
    const s = await setup(broken.db);
    const response = await get(s.app, '/exchange-rates/latest', s.ana);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: 'INTERNAL' });
  });

  it('never calls a provider: the route factory accepts none and the spy has 0 calls', async () => {
    const spy = new ScriptedRateProvider();
    // @ts-expect-error the factory has no provider option
    const factory = createExchangeRateRoutes({ db: connection.db, provider: spy });
    expect(factory).toBeTypeOf('function');
    const s = await setup();
    await seedRates();
    expect((await get(s.app, '/exchange-rates/latest', s.ana)).status).toBe(200);
    expect(spy.calls).toBe(0);
  });

  it('keeps provider ports and adapters out of the read path sources', () => {
    const root = resolve(__dirname, '../../src/exchange-rates');
    for (const file of [
      'infrastructure/http/exchange-rate-routes.ts',
      'infrastructure/http/exchange-rate-presenter.ts',
      'application/get-latest-rates.ts',
    ]) {
      const imports = readFileSync(resolve(root, file), 'utf8')
        .split(/\r?\n/)
        .filter((line) => /^\s*(import|export)\b.*\bfrom\b/.test(line));
      expect(imports.filter((line) => /provider/i.test(line))).toEqual([]);
    }
  });

  it('strips unexpected query keys and still answers 200', async () => {
    const s = await setup();
    await seedRates();
    const response = await get(s.app, '/exchange-rates/latest?foo=bar&rateType=blue', s.ana);
    expect(response.status).toBe(200);
    expect(latestRatesResponseSchema.parse(response.body).rates).toHaveLength(7);
  });
});
