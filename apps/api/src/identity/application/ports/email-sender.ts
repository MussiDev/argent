import type { Language } from '../../domain/account-defaults';

export const OUTBOX_EMAIL_KINDS = ['verification', 'password_reset', 'discard'] as const;
export type OutboxEmailKind = (typeof OUTBOX_EMAIL_KINDS)[number];

/**
 * An email queued for the outbox worker. It never carries a token: the worker issues the token at
 * send time, inside the transaction that sends it, so no link ever rests in the database (R-05).
 * `discard` rows carry no recipient: they are inserted for unknown emails so both paths do the
 * same work (NFR-08), and the worker drops them.
 */
export type OutboxEmail =
  | {
      kind: 'verification' | 'password_reset';
      userId: string;
      toEmail: string;
      language: Language;
    }
  | { kind: 'discard'; userId: null; toEmail: null; language: Language };

/** Enqueues emails; delivery happens outside the request path. */
export interface EmailSender {
  enqueue(email: OutboxEmail): Promise<void>;
}
