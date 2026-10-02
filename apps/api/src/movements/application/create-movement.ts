import { dateInTimeZone, todayInTimeZone, type MovementType } from '@pesly/shared';
import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import {
  CategoryArchived,
  MovementAccountArchived,
  MovementCategoryKindMismatch,
  MovementDateInFuture,
  RateRequired,
} from '../domain/errors';
import type { Movement } from '../domain/movement';
import type { AccountLookup } from './ports/account-lookup';
import type { CategoryLookup } from './ports/category-lookup';
import type { Clock } from './ports/clock';
import type { MovementRepository } from './ports/movement-repository';
import type { RateLookup } from './ports/rate-lookup';
import type { UserPreferences } from './ports/user-preferences';

export interface CreateMovementDependencies {
  movements: MovementRepository;
  accounts: AccountLookup;
  categories: CategoryLookup;
  rates: RateLookup;
  preferences: UserPreferences;
  clock: Clock;
}

/** Already parsed by the shared schema: bigint amounts, a `Date` instant, no empty note. */
export interface CreateMovementInput {
  type: MovementType;
  accountId: string;
  categoryId: string;
  amount: bigint;
  occurredAt: Date;
  note?: string;
  rate: { source: 'automatic' } | { source: 'manual'; value: bigint };
}

export class CreateMovement {
  constructor(private readonly deps: CreateMovementDependencies) {}

  /** Never touches the write limiter, so a bulk import that calls it is not counted. */
  async execute(scope: AccessScope<'write'>, input: CreateMovementInput): Promise<Movement> {
    const { timeZone, defaultRateType } = await this.deps.preferences.find(scope.userId);

    if (
      dateInTimeZone(input.occurredAt, timeZone) > todayInTimeZone(this.deps.clock.now(), timeZone)
    ) {
      throw new MovementDateInFuture();
    }

    const account = notFoundUnlessAllowed(await this.deps.accounts.find(scope, input.accountId));
    if (account.archived) throw new MovementAccountArchived();

    const category = notFoundUnlessAllowed(
      await this.deps.categories.find(scope, input.categoryId),
    );
    if (category.kind !== input.type) throw new MovementCategoryKindMismatch();
    if (category.archived) throw new CategoryArchived();

    let rate: bigint;
    let rateType: Movement['rateType'];
    if (input.rate.source === 'manual') {
      rate = input.rate.value;
      rateType = null;
    } else {
      const stored = await this.deps.rates.latestSell(defaultRateType);
      if (!stored) throw new RateRequired();
      rate = stored.sell;
      rateType = defaultRateType;
    }

    return this.deps.movements.insert(scope, {
      type: input.type,
      accountId: input.accountId,
      categoryId: input.categoryId,
      amount: input.amount,
      occurredAt: input.occurredAt,
      note: input.note === undefined || input.note.trim() === '' ? null : input.note,
      rate,
      rateSource: input.rate.source,
      rateType,
    });
  }
}
