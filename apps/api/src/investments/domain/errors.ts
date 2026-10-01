import { AppError } from '@pesly/shared';

/**
 * A stored-state rule of the investments module was broken. The message is only the field names,
 * never a value, because the error middleware logs the error.
 */
export class InvestmentRuleViolation extends AppError {
  readonly fields: string[];

  constructor(first: string, ...rest: string[]) {
    const fields = [first, ...rest];
    super('VALIDATION_FAILED', fields.join(', '));
    this.fields = fields.map((field) => `body.${field}`);
  }
}
