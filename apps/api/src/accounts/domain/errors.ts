import { AppError } from '@argent/shared';

/** The owner already has an account with this name (compared ignoring case). */
export class AccountNameTaken extends AppError {
  constructor() {
    super('ACCOUNT_NAME_TAKEN');
  }
}

/** The account has movements, so it can only be archived, not deleted. */
export class AccountHasMovements extends AppError {
  constructor() {
    super('ACCOUNT_HAS_MOVEMENTS');
  }
}
