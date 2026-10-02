/** A fixed-window limit: at most `limit` manual creations per `windowSeconds`, per owner. */
export interface WritePolicy {
  limit: number;
  windowSeconds: number;
}

export interface WriteReservation {
  /** Units held in the current window, including this one. */
  count: number;
  /** False once `count` exceeds the policy's limit. */
  allowed: boolean;
  /** The window the unit was recorded in; pass it to `release` to refund exactly this one. */
  windowStart: Date;
}

/** State lives outside the process so every API instance sees the same counters. */
export interface MovementWriteLimiter {
  record(ownerId: string, policy: WritePolicy): Promise<WriteReservation>;
  /** Gives back one unit of the window `windowStart` (never below zero). */
  release(ownerId: string, policy: WritePolicy, windowStart: Date): Promise<void>;
}
