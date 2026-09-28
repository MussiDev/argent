import { createHash, randomBytes } from 'node:crypto';
import type { TokenGenerator } from '../../application/ports/token-generator';

const TOKEN_BYTES = 32;

export class CryptoTokenGenerator implements TokenGenerator {
  generate(): string {
    return randomBytes(TOKEN_BYTES).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
