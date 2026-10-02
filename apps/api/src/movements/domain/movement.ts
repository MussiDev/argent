import type { MovementRateSource, MovementType, RateType } from '@pesly/shared';

export type { MovementRateSource };

export interface Movement {
  id: string;
  ownerId: string;
  type: MovementType;
  accountId: string;
  categoryId: string;
  /** Positive minor units of the account's currency. */
  amount: bigint;
  occurredAt: Date;
  note: string | null;
  /** ARS per USD scaled by 10,000, frozen when the movement is recorded. */
  rate: bigint;
  rateSource: MovementRateSource;
  /** The rate type of an automatic rate; `null` for a manual one. */
  rateType: RateType | null;
  createdAt: Date;
}

/** What the repository stores; the owner comes from the scope, the id and timestamp from storage. */
export type NewMovement = Omit<Movement, 'id' | 'ownerId' | 'createdAt'>;
