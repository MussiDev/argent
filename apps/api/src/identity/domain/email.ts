import { InvalidEmail } from './errors';

export const EMAIL_MAX_LENGTH = 254;
const LOCAL_PART_MAX_LENGTH = 64;

// Basic RFC 5322 addr-spec: dot-atom local part, and a domain of at least two DNS labels.
const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Email value object: trimmed, lower-cased, basic RFC 5322 format, at most 254 characters. */
export class Email {
  private constructor(readonly value: string) {}

  /** Throws `InvalidEmail` (400 `VALIDATION_FAILED`) when the address is not acceptable. */
  static parse(raw: string): Email {
    const value = raw.trim().toLowerCase();
    if (value.length > EMAIL_MAX_LENGTH) throw new InvalidEmail();

    const at = value.lastIndexOf('@');
    const localPart = value.slice(0, at);
    const domain = value.slice(at + 1);
    if (
      at < 1 ||
      localPart.length > LOCAL_PART_MAX_LENGTH ||
      !LOCAL_PART.test(localPart) ||
      !DOMAIN.test(domain)
    ) {
      throw new InvalidEmail();
    }
    return new Email(value);
  }

  toString(): string {
    return this.value;
  }
}
