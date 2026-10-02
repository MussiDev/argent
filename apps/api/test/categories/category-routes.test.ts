import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DEFAULT_CATEGORIES, categoryResponseSchema } from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCategoryRoutes, seedDefaultCategories } from '../../src/categories';
import type { CategoryUsage } from '../../src/categories/application/ports/category-usage';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness, type IdentityHarness } from '../helpers/identity-harness';
import {
  cookieHeader,
  seedUser,
  sessionFrom,
  signIn,
  type SessionCookies,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const PASSWORD = 'a long enough passphrase';
const ANA = 'ana@example.com';
const BOB = 'bob@example.com';

/** Test usage adapter: categories are "used by a movement" when their id is in the set. */
class TestUsage implements CategoryUsage {
  readonly used = new Set<string>();

  isUsed(categoryId: string): Promise<boolean> {
    return Promise.resolve(this.used.has(categoryId));
  }
}

interface Setup {
  harness: IdentityHarness;
  app: Express;
  ana: SessionCookies;
  bob: SessionCookies;
  anaId: string;
  lines: string[];
}

/** Users are inserted without the creation hook: the D9 safety net seeds their defaults. */
async function setup(usage?: CategoryUsage): Promise<Setup> {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const routes = createCategoryRoutes({
    db: connection.db,
    logger,
    ...(usage ? { usage } : {}),
  });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [routes],
  });
  const anaId = await seedUser(connection, { email: ANA, password: PASSWORD });
  await seedUser(connection, { email: BOB, password: PASSWORD });
  const ana = sessionFrom(await signIn(harness.app, ANA, PASSWORD));
  const bob = sessionFrom(await signIn(harness.app, BOB, PASSWORD));
  return { harness, app: harness.app, ana, bob, anaId, lines };
}

function get(app: Express, path: string, cookies?: Partial<SessionCookies>) {
  const call = request(app).get(path);
  if (cookies) call.set('Cookie', cookieHeader(cookies));
  return call;
}

function send(
  app: Express,
  method: 'post' | 'patch' | 'delete',
  path: string,
  cookies?: Partial<SessionCookies>,
  body?: Record<string, unknown>,
) {
  const call = request(app)[method](path).set(trustedHeaders);
  if (cookies) call.set('Cookie', cookieHeader(cookies));
  return call.send(body);
}

const valid = { name: 'Mascotas', kind: 'expense', icon: 'paw-print', color: 'teal' };

async function create(
  s: Setup,
  overrides: Record<string, unknown> = {},
  cookies: SessionCookies = s.ana,
): Promise<string> {
  const response = await send(s.app, 'post', '/categories', cookies, { ...valid, ...overrides });
  expect(response.status).toBe(201);
  return categoryResponseSchema.parse(response.body).id;
}

interface Item {
  id: string;
  kind: string;
  parentId: string | null;
  key: string | null;
  name: string | null;
  icon: string;
  color: string;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
}

interface ListBody {
  items: Item[];
  total: number;
  limit: number;
  offset: number;
}

async function list(s: Setup, query = '', cookies: SessionCookies = s.ana): Promise<ListBody> {
  const response = await get(s.app, `/categories${query}`, cookies);
  expect(response.status).toBe(200);
  return response.body as ListBody;
}

async function idOfKey(s: Setup, key: string, cookies: SessionCookies = s.ana): Promise<string> {
  const found = (await list(s, '', cookies)).items.find((item) => item.key === key);
  if (!found) throw new Error(`No default ${key}`);
  return found.id;
}

async function fetchOne(s: Setup, id: string, cookies: SessionCookies = s.ana): Promise<Item> {
  const response = await get(s.app, `/categories/${id}`, cookies);
  expect(response.status).toBe(200);
  return response.body as Item;
}

describe('GET /categories', () => {
  it('gives a user registered with the creation hook exactly the 33 defaults, key set and name null (AC-01)', async () => {
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      routerFactories: [
        createCategoryRoutes({
          db: connection.db,
          logger: createLogger({ level: 'silent' }),
        }),
      ],
      onUserCreated: [seedDefaultCategories],
      env: { TRUST_PROXY: '1' },
    });
    const registered = await request(harness.app)
      .post('/auth/register')
      .set(trustedHeaders)
      .set('X-Forwarded-For', '203.0.113.9')
      .send({ email: 'carla@example.com', password: PASSWORD });
    expect(registered.status).toBe(202);
    const row = await connection.pool.query<{ id: string }>(
      'select id from users where email = $1',
      ['carla@example.com'],
    );
    const userId = row.rows[0]?.id ?? '';
    await new DrizzleUserRepository(connection.db).markEmailVerified(userId, new Date());
    const session = sessionFrom(await signIn(harness.app, 'carla@example.com', PASSWORD));

    const response = await get(harness.app, '/categories', session);

    expect(response.status).toBe(200);
    const body = response.body as ListBody;
    expect(body.total).toBe(33);
    expect(body.items).toHaveLength(33);
    expect(body.items.map((item) => item.key).sort()).toEqual(
      DEFAULT_CATEGORIES.map((entry) => entry.key).sort(),
    );
    expect(body.items.every((item) => item.name === null)).toBe(true);
    expect(body).toMatchObject({ limit: 100, offset: 0 });
    for (const item of body.items) categoryResponseSchema.parse(item);
  });

  it('seeds the defaults of a user created without the hook on the first request (D9)', async () => {
    const s = await setup();
    const before = await connection.pool.query('select 1 from categories where owner_id = $1', [
      s.anaId,
    ]);
    expect(before.rowCount).toBe(0);
    const body = await list(s);
    expect(body.total).toBe(33);
    expect(body.items.every((item) => item.key !== null && item.name === null)).toBe(true);
  });

  it('filters by kind and pages with limit and offset', async () => {
    const s = await setup();
    const incomes = DEFAULT_CATEGORIES.filter((entry) => entry.kind === 'income').length;
    const body = await list(s, '?kind=income');
    expect(body.total).toBe(incomes);
    expect(body.items.every((item) => item.kind === 'income')).toBe(true);
    const page = await list(s, '?limit=5&offset=30');
    expect(page.items).toHaveLength(3);
    expect(page).toMatchObject({ total: 33, limit: 5, offset: 30 });
  });
});

describe('POST /categories', () => {
  it('creates a category (201) that appears in the list and under its kind (AC-02)', async () => {
    const s = await setup();
    const response = await send(s.app, 'post', '/categories', s.ana, valid);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: 'Mascotas',
      kind: 'expense',
      icon: 'paw-print',
      color: 'teal',
      key: null,
      parentId: null,
      archived: false,
      archivedAt: null,
    });
    const created = categoryResponseSchema.parse(response.body);
    expect((await list(s)).items.map((item) => item.id)).toContain(created.id);
    expect((await list(s, '?kind=expense')).items.map((item) => item.id)).toContain(created.id);
    expect((await list(s, '?kind=income')).items.map((item) => item.id)).not.toContain(created.id);
  });

  it('creates a subcategory under a default parent', async () => {
    const s = await setup();
    const parentId = await idOfKey(s, 'food');
    const id = await create(s, { name: 'Panadería', parentId });
    expect(await fetchOne(s, id)).toMatchObject({ parentId, name: 'Panadería' });
  });

  it('refuses a subcategory under a subcategory with CATEGORY_NESTING_TOO_DEEP (AC-03)', async () => {
    const s = await setup();
    const child = await idOfKey(s, 'food.groceries');
    const response = await send(s.app, 'post', '/categories', s.ana, {
      ...valid,
      parentId: child,
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'CATEGORY_NESTING_TOO_DEEP' });
  });

  it('refuses a parent of another kind with CATEGORY_PARENT_KIND_MISMATCH (AC-04)', async () => {
    const s = await setup();
    const parentId = await idOfKey(s, 'food');
    const response = await send(s.app, 'post', '/categories', s.ana, {
      ...valid,
      kind: 'income',
      parentId,
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'CATEGORY_PARENT_KIND_MISMATCH' });
  });

  it('rejects an invalid body with VALIDATION_FAILED and no echo of the values', async () => {
    const s = await setup();
    const response = await send(s.app, 'post', '/categories', s.ana, {
      ...valid,
      name: '   ',
      icon: 'not-an-icon',
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(JSON.stringify(response.body)).not.toContain('not-an-icon');
  });

  it('refuses a duplicate name in any case and the Spanish or English name of an untouched sibling default (AC-11)', async () => {
    const s = await setup();
    await create(s, { name: 'Café' });
    for (const name of ['café', 'CAFÉ', 'Comida', 'comida', 'Food', 'FOOD']) {
      const response = await send(s.app, 'post', '/categories', s.ana, { ...valid, name });
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'CATEGORY_NAME_TAKEN' });
    }
    // The same name under another kind is accepted.
    await create(s, { name: 'Café', kind: 'income' });
  });
});

describe('GET /categories/:id and PATCH /categories/:id', () => {
  it('persists name, icon and color and returns them (AC-05)', async () => {
    const s = await setup();
    const id = await create(s);
    const response = await send(s.app, 'patch', `/categories/${id}`, s.ana, {
      name: 'Perros',
      icon: 'dumbbell',
      color: 'red',
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id, name: 'Perros', icon: 'dumbbell', color: 'red' });
    expect(await fetchOne(s, id)).toMatchObject({ name: 'Perros', icon: 'dumbbell', color: 'red' });
  });

  it('answers 400 for kind, parentId or an empty body and leaves the category unchanged (AC-05)', async () => {
    const s = await setup();
    const id = await create(s);
    const parentId = await idOfKey(s, 'food');
    for (const body of [{ kind: 'income' }, { parentId }, { name: 'X', kind: 'expense' }, {}]) {
      const response = await send(s.app, 'patch', `/categories/${id}`, s.ana, body);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(await fetchOne(s, id)).toMatchObject({
      name: 'Mascotas',
      kind: 'expense',
      parentId: null,
    });
  });

  it('refuses a rename to a duplicate in any case or to an untouched sibling default name (AC-11)', async () => {
    const s = await setup();
    await create(s, { name: 'Café' });
    const id = await create(s, { name: 'Otro' });
    for (const name of ['CAFÉ', 'Comida', 'food']) {
      const response = await send(s.app, 'patch', `/categories/${id}`, s.ana, { name });
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'CATEGORY_NAME_TAKEN' });
    }
    expect(await fetchOne(s, id)).toMatchObject({ name: 'Otro' });
  });

  it('renames a default: custom name returned, key kept, old translations free (AC-16, AC-17)', async () => {
    const s = await setup();
    const id = await idOfKey(s, 'food');
    const response = await send(s.app, 'patch', `/categories/${id}`, s.ana, { name: 'Alimentos' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id, name: 'Alimentos', key: 'food' });
    for (const name of ['Comida', 'Food']) {
      const reuse = await send(s.app, 'post', '/categories', s.ana, { ...valid, name });
      expect(reuse.status).toBe(201);
      await send(s.app, 'delete', `/categories/${(reuse.body as Item).id}`, s.ana);
    }
    // Editing only icon or color keeps another default translating (D4).
    const other = await idOfKey(s, 'transport');
    const recolored = await send(s.app, 'patch', `/categories/${other}`, s.ana, { color: 'red' });
    expect(recolored.body).toMatchObject({ name: null, key: 'transport', color: 'red' });
  });
});

describe('archive and unarchive', () => {
  it('archive hides from the default list, keeps GET, lists under archived=true and archives subcategories (AC-06, AC-07)', async () => {
    const s = await setup();
    const parent = await idOfKey(s, 'food');
    const child = await idOfKey(s, 'food.groceries');
    const response = await send(s.app, 'post', `/categories/${parent}/archive`, s.ana);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: parent, archived: true });
    expect((response.body as Item).archivedAt).toEqual(expect.any(String));

    const active = (await list(s)).items.map((item) => item.id);
    expect(active).not.toContain(parent);
    expect(active).not.toContain(child);
    const archived = (await list(s, '?archived=true')).items.map((item) => item.id);
    // The parent and its three default subcategories, nothing else.
    expect(archived).toHaveLength(4);
    expect(archived).toContain(parent);
    expect(archived).toContain(child);
    expect(await fetchOne(s, parent)).toMatchObject({ archived: true });
    expect(await fetchOne(s, child)).toMatchObject({ archived: true });
  });

  it('unarchive restores only the target, idempotently (AC-08)', async () => {
    const s = await setup();
    const parent = await idOfKey(s, 'food');
    const child = await idOfKey(s, 'food.groceries');
    await send(s.app, 'post', `/categories/${parent}/archive`, s.ana);
    for (let i = 0; i < 2; i += 1) {
      const response = await send(s.app, 'post', `/categories/${parent}/unarchive`, s.ana);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: parent, archived: false, archivedAt: null });
    }
    expect(await fetchOne(s, child)).toMatchObject({ archived: true });
    expect((await list(s)).items.map((item) => item.id)).toContain(parent);
    // Archiving twice is idempotent too.
    expect((await send(s.app, 'post', `/categories/${parent}/archive`, s.ana)).status).toBe(200);
    expect((await send(s.app, 'post', `/categories/${parent}/archive`, s.ana)).status).toBe(200);
  });
});

describe('DELETE /categories/:id', () => {
  it('answers 204 for an unused leaf (AC-09)', async () => {
    const s = await setup();
    const id = await create(s);
    const response = await send(s.app, 'delete', `/categories/${id}`, s.ana);
    expect(response.status).toBe(204);
    expect((await get(s.app, `/categories/${id}`, s.ana)).status).toBe(404);
  });

  it('answers 409 CATEGORY_IN_USE for a category with a subcategory and keeps the row (AC-10)', async () => {
    const s = await setup();
    const id = await idOfKey(s, 'food');
    const response = await send(s.app, 'delete', `/categories/${id}`, s.ana);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'CATEGORY_IN_USE' });
    expect(await fetchOne(s, id)).toMatchObject({ key: 'food' });
  });

  it('answers 409 CATEGORY_IN_USE for a category the usage adapter reports used (AC-10)', async () => {
    const usage = new TestUsage();
    const s = await setup(usage);
    const id = await create(s);
    usage.used.add(id);
    const response = await send(s.app, 'delete', `/categories/${id}`, s.ana);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'CATEGORY_IN_USE' });
    expect(await fetchOne(s, id)).toMatchObject({ name: 'Mascotas' });
  });
});

describe('ownership (AC-12, AC-13)', () => {
  it('lists only the caller categories (AC-13)', async () => {
    const s = await setup();
    await create(s, { name: 'Solo Ana' });
    await create(s, { name: 'Solo Bob' }, s.bob);
    const ana = (await list(s)).items.map((item) => item.name);
    const bob = (await list(s, '', s.bob)).items.map((item) => item.name);
    expect(ana).toContain('Solo Ana');
    expect(ana).not.toContain('Solo Bob');
    expect(bob).toContain('Solo Bob');
    expect(bob).not.toContain('Solo Ana');
    expect((await list(s, '', s.bob)).total).toBe(34);
  });

  it('answers another user category, and a foreign parent, exactly like a missing id (AC-12)', async () => {
    const s = await setup();
    const id = await create(s);
    const missing = randomUUID();
    const as = (target: string) => ({
      get: () => get(s.app, `/categories/${target}`, s.bob),
      patch: () => send(s.app, 'patch', `/categories/${target}`, s.bob, { name: 'hacked' }),
      archive: () => send(s.app, 'post', `/categories/${target}/archive`, s.bob),
      unarchive: () => send(s.app, 'post', `/categories/${target}/unarchive`, s.bob),
      remove: () => send(s.app, 'delete', `/categories/${target}`, s.bob),
      createUnder: () =>
        send(s.app, 'post', '/categories', s.bob, { ...valid, name: 'Hijo', parentId: target }),
    });
    for (const name of ['get', 'patch', 'archive', 'unarchive', 'remove', 'createUnder'] as const) {
      const foreign = await as(id)[name]();
      const absent = await as(missing)[name]();
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(absent.body);
      expect(foreign.body).toEqual({ code: 'NOT_FOUND' });
    }
    expect(await fetchOne(s, id)).toMatchObject({ name: 'Mascotas', archived: false });
  });
});

describe('input validation (NFR-01)', () => {
  it('accepts limit 100 and rejects 101', async () => {
    const s = await setup();
    expect((await get(s.app, '/categories?limit=100', s.ana)).status).toBe(200);
    const response = await get(s.app, '/categories?limit=101', s.ana);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it.each([
    '?limit=',
    '?offset=',
    '?limit=0',
    '?offset=-1',
    '?archived=maybe',
    '?archived=',
    '?kind=other',
  ])('list rejects %s with 400', async (query) => {
    const s = await setup();
    const response = await get(s.app, `/categories${query}`, s.ana);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it.each([
    ['get', 'get', (id: string) => `/categories/${id}`],
    ['patch', 'patch', (id: string) => `/categories/${id}`],
    ['archive', 'post', (id: string) => `/categories/${id}/archive`],
    ['unarchive', 'post', (id: string) => `/categories/${id}/unarchive`],
    ['delete', 'delete', (id: string) => `/categories/${id}`],
  ] as const)('%s rejects a non-UUID id with 400 VALIDATION_FAILED', async (_n, method, path) => {
    const s = await setup();
    const url = path('not-a-uuid');
    const response =
      method === 'get'
        ? await get(s.app, url, s.ana)
        : await send(s.app, method, url, s.ana, method === 'patch' ? { name: 'x' } : undefined);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('authentication and request guards', () => {
  const routes: [string, 'get' | 'post' | 'patch' | 'delete', (id: string) => string][] = [
    ['list', 'get', () => '/categories'],
    ['create', 'post', () => '/categories'],
    ['get', 'get', (id) => `/categories/${id}`],
    ['patch', 'patch', (id) => `/categories/${id}`],
    ['archive', 'post', (id) => `/categories/${id}/archive`],
    ['unarchive', 'post', (id) => `/categories/${id}/unarchive`],
    ['delete', 'delete', (id) => `/categories/${id}`],
  ];

  function call(
    app: Express,
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    cookies?: SessionCookies,
  ) {
    const req = request(app)[method](path).set(trustedHeaders);
    if (cookies) req.set('Cookie', cookieHeader(cookies));
    return req.send(method === 'get' || method === 'delete' ? undefined : { ...valid });
  }

  it.each(routes)('%s answers 401 without a session', async (_name, method, path) => {
    const s = await setup();
    const response = await call(s.app, method, path(randomUUID()));
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 'UNAUTHENTICATED' });
  });

  it.each(routes)(
    '%s answers 403 EMAIL_NOT_VERIFIED for an unverified user',
    async (_n, method, path) => {
      const s = await setup();
      await seedUser(connection, { email: 'eve@example.com', password: PASSWORD, verified: false });
      const eve = sessionFrom(await signIn(s.app, 'eve@example.com', PASSWORD));
      const response = await call(s.app, method, path(randomUUID()), eve);
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
    },
  );

  it('refuses a state-changing request without the web origin headers (error path)', async () => {
    const s = await setup();
    const noOrigin = await request(s.app)
      .post('/categories')
      .set('Cookie', cookieHeader(s.ana))
      .send(valid);
    expect(noOrigin.status).toBe(403);
    const noHeader = await request(s.app)
      .post('/categories')
      .set('Origin', trustedHeaders.Origin)
      .set('Cookie', cookieHeader(s.ana))
      .send(valid);
    expect(noHeader.status).toBe(403);
    expect((await list(s)).items.map((item) => item.name)).not.toContain('Mascotas');
  });
});

describe('audit log (NFR-02)', () => {
  it('records user id and category id for create, update, archive, unarchive and delete, never a name', async () => {
    const s = await setup();
    const name = 'Secret Category Name';
    const renamed = 'Renamed Secret Name';
    const id = await create(s, { name });
    await send(s.app, 'patch', `/categories/${id}`, s.ana, { name: renamed });
    await send(s.app, 'post', `/categories/${id}/archive`, s.ana);
    await send(s.app, 'post', `/categories/${id}/unarchive`, s.ana);
    await send(s.app, 'delete', `/categories/${id}`, s.ana);

    const audit = s.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => typeof entry.msg === 'string' && entry.msg.startsWith('category '));
    expect(audit.map((entry) => entry.msg)).toEqual([
      'category created',
      'category updated',
      'category archived',
      'category unarchived',
      'category deleted',
    ]);
    // Allowlist: pino base keys plus the audit fields; a new field must be added here on purpose.
    const allowed = new Set([
      'level',
      'time',
      'pid',
      'hostname',
      'msg',
      'requestId',
      'userId',
      'categoryId',
    ]);
    for (const entry of audit) {
      expect(entry).toMatchObject({ userId: s.anaId, categoryId: id });
      expect(Object.keys(entry).filter((key) => !allowed.has(key))).toEqual([]);
      expect(entry.requestId).toEqual(expect.any(String));
      const text = JSON.stringify(entry);
      expect(text).not.toContain(name);
      expect(text).not.toContain(renamed);
    }
  });
});

describe('AGENTS.md (Q4, D8)', () => {
  const agents = readFileSync(new URL('../../../../AGENTS.md', import.meta.url), 'utf8').replace(
    /\s+/g,
    ' ',
  );

  it('lists categories among the modules', () => {
    const modules = /Modules follow the PRDs[^.]*?\)\s*:\s*([^.]*)\./.exec(agents)?.[1] ?? '';
    expect(modules).toContain('`categories`');
  });

  it('states the default-names exception', () => {
    expect(agents).toContain('packages/shared/src/categories');
    expect(agents).toMatch(/default category names/i);
    expect(agents).toMatch(/uniqueness across languages/i);
  });
});
