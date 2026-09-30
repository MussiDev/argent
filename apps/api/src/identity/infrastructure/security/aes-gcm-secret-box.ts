import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { SecretBoxUnavailable, type SecretBox } from '../../application/ports/secret-box';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** A base64 key of exactly 32 bytes; anything else is refused rather than padded or truncated. */
export function decodeSecretBoxKey(key: string): Buffer {
  const bytes = Buffer.from(key, 'base64');
  if (!BASE64.test(key) || key.length % 4 !== 0 || bytes.length !== KEY_BYTES) {
    throw new Error(`the secret box key must be base64 of exactly ${KEY_BYTES} bytes`);
  }
  return bytes;
}

class UnopenableSecret extends Error {
  constructor(cause?: unknown) {
    super('sealed secret cannot be opened', cause === undefined ? undefined : { cause });
    this.name = 'UnopenableSecret';
  }
}

/**
 * AES-256-GCM with a random 96-bit IV per seal. The result is
 * `v1.<keyId>.<iv>.<ciphertext>.<tag>` (base64url), where `keyId` names the key so a future
 * rotation can tell which one sealed a value.
 */
export class AesGcmSecretBox implements SecretBox {
  private readonly key: Buffer;
  private readonly keyId: string;

  constructor(base64Key: string) {
    this.key = decodeSecretBoxKey(base64Key);
    this.keyId = createHash('sha256').update(this.key).digest('hex').slice(0, 8);
  }

  seal(plaintext: string, associatedData: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      this.keyId,
      ...[iv, ciphertext, tag].map((part) => part.toString('base64url')),
    ].join('.');
  }

  open(sealed: string, associatedData: string): string {
    const [version, keyId, iv, ciphertext, tag, ...rest] = sealed.split('.');
    if (
      version !== VERSION ||
      keyId !== this.keyId ||
      iv === undefined ||
      ciphertext === undefined ||
      tag === undefined ||
      rest.length > 0
    ) {
      throw new UnopenableSecret();
    }
    const ivBytes = Buffer.from(iv, 'base64url');
    const tagBytes = Buffer.from(tag, 'base64url');
    // GCM accepts shorter tags; only a full-length one is allowed here.
    if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) throw new UnopenableSecret();
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, ivBytes, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(Buffer.from(associatedData, 'utf8'));
      decipher.setAuthTag(tagBytes);
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      throw new UnopenableSecret(error);
    }
  }
}

/** Used when no key is configured (only possible outside production): 2FA is unavailable. */
export class UnavailableSecretBox implements SecretBox {
  seal(): string {
    throw new SecretBoxUnavailable();
  }

  open(): string {
    throw new SecretBoxUnavailable();
  }
}
