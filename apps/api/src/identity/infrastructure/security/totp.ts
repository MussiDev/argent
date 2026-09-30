import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { TotpEngine } from '../../application/ports/totp';

const ISSUER = 'Pesly';
const DIGITS = 6;
const STEP_SECONDS = 30;
/** Steps accepted before and after the current one (NFR-03). */
const WINDOW = 1;
const SECRET_BYTES = 20;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const CODE_FORMAT = new RegExp(`^[0-9]{${DIGITS}}$`);

function base32Encode(bytes: Buffer): string {
  let buffer = 0;
  let bits = 0;
  let output = '';
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET.charAt((buffer >> bits) & 0b11111);
    }
  }
  if (bits > 0) output += BASE32_ALPHABET.charAt((buffer << (5 - bits)) & 0b11111);
  return output;
}

function base32Decode(encoded: string): Buffer {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of encoded.replace(/=+$/, '').toUpperCase()) {
    const value = BASE32_ALPHABET.indexOf(character);
    if (value === -1) throw new Error('secret is not base32');
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** HOTP (RFC 4226) with HMAC-SHA1 and dynamic truncation to 6 digits, for a base32 secret. */
export function hotp(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/** RFC 6238 TOTP: 6 digits, 30-second steps, one step of tolerance each way (NFR-03). */
export class RfcTotpEngine implements TotpEngine {
  generateSecret(): string {
    return base32Encode(randomBytes(SECRET_BYTES));
  }

  verify(secret: string, code: string, now: Date): number | null {
    if (!CODE_FORMAT.test(code)) return null;
    const current = Math.floor(now.getTime() / 1000 / STEP_SECONDS);
    const given = Buffer.from(code);
    let matched: number | null = null;
    // Every step in the window is compared, so the time taken does not reveal which one matched.
    for (let step = current - WINDOW; step <= current + WINDOW; step += 1) {
      const equal = timingSafeEqual(Buffer.from(hotp(secret, step)), given);
      if (equal && matched === null) matched = step;
    }
    return matched;
  }

  otpauthUri(secret: string, accountEmail: string): string {
    const label = `${ISSUER}:${encodeURIComponent(accountEmail)}`;
    return `otpauth://totp/${label}?secret=${secret}&issuer=${ISSUER}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
  }
}
