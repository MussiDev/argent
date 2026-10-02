import { AppError } from '@pesly/shared';

/**
 * A stored-state rule of the investments module was broken. The message is only the field names,
 * never a value, because the error middleware logs the error; `fields` carries them as
 * `body.<field>` paths for the response.
 */
export class InvestmentRuleViolation extends AppError {
  constructor(first: string, ...rest: string[]) {
    const names = [first, ...rest];
    super(
      'VALIDATION_FAILED',
      names.join(', '),
      names.map((name) => `body.${name}`),
    );
  }
}
