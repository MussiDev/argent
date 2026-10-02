export type RateProviderFailureCode =
  'provider_unreachable' | 'provider_timeout' | 'provider_bad_status' | 'provider_invalid_payload';

export interface RateProviderFailureOptions {
  statusCode?: number;
  /** Names the failing item (for example a rate type); never provider text. */
  detail?: string;
}

/** The provider could not give a usable answer; the refresh records it and retries later. */
export class RateProviderFailure extends Error {
  readonly code: RateProviderFailureCode;
  readonly statusCode?: number;
  readonly detail?: string;

  constructor(code: RateProviderFailureCode, options: RateProviderFailureOptions = {}) {
    super(code);
    this.name = 'RateProviderFailure';
    this.code = code;
    if (options.statusCode !== undefined) this.statusCode = options.statusCode;
    if (options.detail !== undefined) this.detail = options.detail;
  }
}
