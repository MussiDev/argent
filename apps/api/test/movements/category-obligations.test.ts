import { randomUUID } from 'node:crypto';
import { categoryResponseSchema } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory } from './db-fixtures';
import {
  get,
  movementBody,
  obligationsSetup,
  send,
  type ObligationsSetup,
} from './obligations-harness';

/** Deferred behavior of DISC-001-02b, end to end with real movements (spec 03b, Block 7). */

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

async function usedCategory(s: ObligationsSetup): Promise<string> {
  const accountId = await newAccount(connection.pool, s.anaId);
  // Created through the route: the shared DB fixture uses an icon outside the public palette.
  const category = await send(s.app, 'post', '/categories', s.ana, {
    name: `Comida ${randomUUID()}`.slice(0, 40),
    kind: 'expense',
    icon: 'utensils',
    color: 'red',
  });
  expect(category.status).toBe(201);
  const categoryId = categoryResponseSchema.parse(category.body).id;
  const created = await send(
    s.app,
    'post',
    '/movements',
    s.ana,
    movementBody({ type: 'expense', accountId, categoryId, amount: '700' }),
  );
  expect(created.status).toBe(201);
  return categoryId;
}

async function movementCategoryIds(s: ObligationsSetup): Promise<string[]> {
  const listed = await get(s.app, '/movements', s.ana);
  expect(listed.status).toBe(200);
  return (listed.body as { items: { categoryId: string }[] }).items.map((m) => m.categoryId);
}

describe('category obligations with real movements', () => {
  // The 409 comes from the foreign key as well as the real adapter; the wiring is pinned by the server.ts source check in erasure-step.test.ts.
  it('a category used by a movement cannot be deleted: 409 CATEGORY_IN_USE, rows intact (AC-19)', async () => {
    const s = await obligationsSetup(connection);
    const categoryId = await usedCategory(s);

    const response = await send(s.app, 'delete', `/categories/${categoryId}`, s.ana);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'CATEGORY_IN_USE' });
    expect((await get(s.app, `/categories/${categoryId}`, s.ana)).status).toBe(200);
    expect(await movementCategoryIds(s)).toEqual([categoryId]);
  });

  it('renaming a used category shows the new name for its existing movement (AC-19)', async () => {
    const s = await obligationsSetup(connection);
    const categoryId = await usedCategory(s);

    const renamed = await send(s.app, 'patch', `/categories/${categoryId}`, s.ana, {
      name: 'Supermercado',
    });
    expect(renamed.status).toBe(200);

    const [shown] = await movementCategoryIds(s);
    expect(shown).toBe(categoryId);
    const category = await get(s.app, `/categories/${String(shown)}`, s.ana);
    expect(categoryResponseSchema.parse(category.body).name).toBe('Supermercado');
  });

  it('archiving a used category keeps it on its movement and still resolvable (AC-19)', async () => {
    const s = await obligationsSetup(connection);
    const categoryId = await usedCategory(s);

    const archived = await send(s.app, 'post', `/categories/${categoryId}/archive`, s.ana);
    expect(archived.status).toBe(200);

    expect(await movementCategoryIds(s)).toEqual([categoryId]);
    const category = await get(s.app, `/categories/${categoryId}`, s.ana);
    expect(categoryResponseSchema.parse(category.body)).toMatchObject({
      id: categoryId,
      archived: true,
    });
    const defaultList = await get(s.app, '/categories?kind=expense&limit=100', s.ana);
    expect((defaultList.body as { items: { id: string }[] }).items.map((c) => c.id)).not.toContain(
      categoryId,
    );
  });

  it("another user's movements do not make my category in use, and my delete still works (error path)", async () => {
    const s = await obligationsSetup(connection);
    await usedCategory(s);
    const mine = await newCategory(connection.pool, s.bobId, 'expense');

    const response = await send(s.app, 'delete', `/categories/${mine}`, s.bob);
    expect(response.status).toBe(204);
  });
});
