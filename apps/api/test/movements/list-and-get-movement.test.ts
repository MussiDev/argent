import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@pesly/shared';
import { GetMovement } from '../../src/movements/application/get-movement';
import { ListMovements } from '../../src/movements/application/list-movements';
import { ResourceNotFound } from '../../src/shared/access';
import { InMemoryMovementRepository, readScopeFor } from './fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

let movements: InMemoryMovementRepository;
let list: ListMovements;
let get: GetMovement;

beforeEach(() => {
  movements = new InMemoryMovementRepository();
  list = new ListMovements({ movements });
  get = new GetMovement({ movements });
});

describe('ListMovements', () => {
  it('returns only the scope movements, newest first, stable for equal dates', async () => {
    const old = movements.seed(ALICE, { occurredAt: new Date('2026-09-01T00:00:00Z') });
    const recent = movements.seed(ALICE, { occurredAt: new Date('2026-10-01T00:00:00Z') });
    const tieA = movements.seed(ALICE, { occurredAt: new Date('2026-09-15T00:00:00Z') });
    const tieB = movements.seed(ALICE, { occurredAt: new Date('2026-09-15T00:00:00Z') });
    movements.seed(BOB);

    const first = await list.execute(await readScopeFor(ALICE), { limit: 50, offset: 0 });
    const second = await list.execute(await readScopeFor(ALICE), { limit: 50, offset: 0 });

    expect(first.total).toBe(4);
    const ties = [tieA.id, tieB.id].sort().reverse();
    expect(first.items.map((m) => m.id)).toEqual([recent.id, ...ties, old.id]);
    expect(second.items.map((m) => m.id)).toEqual(first.items.map((m) => m.id));
  });

  it('applies offset and limit and re-validates them', async () => {
    for (let i = 0; i < 3; i++) movements.seed(ALICE);
    const scope = await readScopeFor(ALICE);

    const page = await list.execute(scope, { limit: 2, offset: 2 });
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(3);

    for (const bad of [
      { limit: 0, offset: 0 },
      { limit: 101, offset: 0 },
      { limit: 1.5, offset: 0 },
      { limit: 10, offset: -1 },
      { limit: 10, offset: 0.5 },
    ]) {
      await expect(list.execute(scope, bad)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(list.execute(scope, bad)).rejects.toBeInstanceOf(AppError);
    }
    await expect(list.execute(scope, { limit: 100, offset: 0 })).resolves.toBeDefined();
  });
});

describe('GetMovement', () => {
  it('returns an own movement and 404s on a foreign or unknown id', async () => {
    const mine = movements.seed(ALICE);
    const theirs = movements.seed(BOB);
    const scope = await readScopeFor(ALICE);

    await expect(get.execute(scope, mine.id)).resolves.toMatchObject({ id: mine.id });
    await expect(get.execute(scope, theirs.id)).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(get.execute(scope, '33333333-3333-4333-8333-333333333333')).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });
});
