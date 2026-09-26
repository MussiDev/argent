import type { Clock } from '../../src/identity/application/ports/clock';

/** A clock tests move by hand, to cross expiries, rate-limit windows and retry delays. */
export class MutableClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date()) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
