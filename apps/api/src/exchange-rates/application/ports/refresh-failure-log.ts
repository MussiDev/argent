import type { RateProviderFailureCode } from '../../domain/errors';

export interface RefreshFailureRecord {
  at: Date;
  code: RateProviderFailureCode;
  statusCode?: number;
  detail?: string;
}

export interface RefreshFailureLog {
  record(failure: RefreshFailureRecord): Promise<void>;
  /** Returns how many records were deleted. */
  purgeOlderThan(cutoff: Date): Promise<number>;
}
