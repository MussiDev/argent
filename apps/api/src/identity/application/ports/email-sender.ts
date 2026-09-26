import type { Language } from '../../domain/account-defaults';

/**
 * An email queued for the outbox worker. `discard` rows carry no recipient: they are inserted for
 * unknown emails so both paths do the same work (NFR-08), and the worker drops them.
 */
export type OutboxEmail =
  | { kind: 'verification'; to: string; language: Language; token: string }
  | { kind: 'password_reset'; to: string; language: Language; token: string }
  | { kind: 'discard'; language: Language };

/** Enqueues emails; delivery happens outside the request path. */
export interface EmailSender {
  enqueue(email: OutboxEmail): Promise<void>;
}
