import { RATE_TYPES } from '@pesly/shared';
import type { Clock } from '../../src/exchange-rates/application/ports/clock';
import type { RateProvider } from '../../src/exchange-rates/application/ports/rate-provider';
import type { RateRepository } from '../../src/exchange-rates/application/ports/rate-repository';
import type {
  RefreshFailureLog,
  RefreshFailureRecord,
} from '../../src/exchange-rates/application/ports/refresh-failure-log';
import type { RefreshSchedule } from '../../src/exchange-rates/application/ports/refresh-schedule';
import type { RateQuote, StoredRate } from '../../src/exchange-rates/domain/rate-quote';

export class MutableClock implements Clock {
  constructor(public current: Date = new Date('2026-10-02T12:00:00.000Z')) {}

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export function sampleQuotes(
  providerUpdatedAt = new Date('2026-10-02T11:50:00.000Z'),
): RateQuote[] {
  return RATE_TYPES.map((rateType, index) => ({
    rateType,
    buy: 10_000_000n + BigInt(index) * 10_000n,
    sell: 10_100_000n + BigInt(index) * 10_000n,
    providerUpdatedAt,
  }));
}

/** Scriptable provider: returns the configured quotes, or throws the configured error. */
export class ScriptedRateProvider implements RateProvider {
  calls = 0;
  quotes: RateQuote[] = sampleQuotes();
  error: Error | null = null;

  async fetchQuotes(): Promise<RateQuote[]> {
    await Promise.resolve();
    this.calls += 1;
    if (this.error) throw this.error;
    return this.quotes;
  }
}

export class InMemoryRateRepository implements RateRepository {
  rows: StoredRate[] = [];
  replaceCalls = 0;
  /** When set, `replaceAll` throws it before touching the rows. */
  replaceError: Error | null = null;

  async replaceAll(quotes: readonly RateQuote[], fetchedAt: Date): Promise<void> {
    await Promise.resolve();
    this.replaceCalls += 1;
    if (this.replaceError) throw this.replaceError;
    this.rows = quotes.map((quote) => ({ ...quote, fetchedAt }));
  }

  async findAll(): Promise<StoredRate[]> {
    await Promise.resolve();
    return [...this.rows];
  }
}

export class InMemoryRefreshSchedule implements RefreshSchedule {
  nextAttemptAt: Date | null = null;
  lastSuccessAt: Date | null = null;
  consecutiveFailures = 0;
  claims: { now: Date; leaseMs: number }[] = [];
  /** When set, `succeeded` and `failed` throw it. */
  updateError: Error | null = null;

  async claim(now: Date, leaseMs: number): Promise<Date | null> {
    await Promise.resolve();
    this.claims.push({ now, leaseMs });
    if (this.nextAttemptAt && this.nextAttemptAt.getTime() > now.getTime()) return null;
    this.nextAttemptAt = new Date(now.getTime() + leaseMs);
    return this.nextAttemptAt;
  }

  async succeeded(lease: Date, now: Date, intervalMs: number): Promise<void> {
    await Promise.resolve();
    if (this.updateError) throw this.updateError;
    if (this.nextAttemptAt?.getTime() !== lease.getTime()) return;
    this.nextAttemptAt = new Date(now.getTime() + intervalMs);
    this.lastSuccessAt = now;
    this.consecutiveFailures = 0;
  }

  async failed(lease: Date, now: Date, retryMs: number): Promise<void> {
    await Promise.resolve();
    if (this.updateError) throw this.updateError;
    if (this.nextAttemptAt?.getTime() !== lease.getTime()) return;
    this.nextAttemptAt = new Date(now.getTime() + retryMs);
    this.consecutiveFailures += 1;
  }
}

export class InMemoryRefreshFailureLog implements RefreshFailureLog {
  records: RefreshFailureRecord[] = [];

  async record(failure: RefreshFailureRecord): Promise<void> {
    await Promise.resolve();
    this.records.push(failure);
  }

  async purgeOlderThan(cutoff: Date): Promise<number> {
    await Promise.resolve();
    const kept = this.records.filter((r) => r.at.getTime() >= cutoff.getTime());
    const purged = this.records.length - kept.length;
    this.records = kept;
    return purged;
  }
}
