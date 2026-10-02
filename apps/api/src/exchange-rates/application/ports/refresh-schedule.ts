/** Single shared schedule row; the lease expiry identifies the owner of a running refresh. */
export interface RefreshSchedule {
  /** The lease expiry when this caller owns the refresh, `null` when it is not due or leased. */
  claim(now: Date, leaseMs: number): Promise<Date | null>;
  /** A stale lease changes nothing. */
  succeeded(lease: Date, now: Date, intervalMs: number): Promise<void>;
  /** A stale lease changes nothing. */
  failed(lease: Date, now: Date, retryMs: number): Promise<void>;
}
