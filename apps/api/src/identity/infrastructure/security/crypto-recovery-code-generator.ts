import { randomBytes } from 'node:crypto';
import type { RecoveryCodeGenerator } from '../../application/ports/recovery-code-generator';
import {
  CROCKFORD_ALPHABET,
  formatRecoveryCode,
  RECOVERY_CODE_LENGTH,
} from '../../domain/recovery-code';

const BITS_PER_CHARACTER = 5;
/** 10 characters of 5 bits: 50 random bits per code. */
const CODE_BYTES = Math.ceil((RECOVERY_CODE_LENGTH * BITS_PER_CHARACTER) / 8);

function randomCode(): string {
  const bytes = randomBytes(CODE_BYTES);
  let buffer = 0;
  let bits = 0;
  let code = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= BITS_PER_CHARACTER && code.length < RECOVERY_CODE_LENGTH) {
      bits -= BITS_PER_CHARACTER;
      code += CROCKFORD_ALPHABET.charAt((buffer >> bits) & 0b11111);
    }
    buffer &= (1 << bits) - 1;
  }
  return formatRecoveryCode(code);
}

export class CryptoRecoveryCodeGenerator implements RecoveryCodeGenerator {
  generate(count: number): string[] {
    const codes = new Set<string>();
    while (codes.size < count) codes.add(randomCode());
    return [...codes];
  }
}
