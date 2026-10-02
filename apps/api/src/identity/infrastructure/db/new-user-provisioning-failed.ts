/**
 * A user-created hook rejected, so the sign-up transaction rolled back. A distinct type (not an
 * AppError: the response stays a generic 500) so the shared error handler's log line tells a
 * seeding failure apart from other registration failures. The message is fixed on purpose: the
 * original error travels as `cause` and is serialized by the logger's own safe rules.
 */
export class NewUserProvisioningFailed extends Error {
  constructor(cause: unknown) {
    super('A user-created hook failed', { cause });
    this.name = 'NewUserProvisioningFailed';
  }
}
