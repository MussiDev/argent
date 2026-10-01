import { createHmac } from 'node:crypto';

/**
 * A test authenticator app: RFC 6238 codes (HMAC-SHA1, 6 digits, 30-second steps) computed from
 * the base32 secret the settings screen shows. Written independently of the API's engine so the
 * e2e flows check it against the RFC, not against itself.
 */
const STEP_MS = 30_000;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(secret: string): Buffer {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of secret.replace(/\s+/g, '').toUpperCase()) {
    const value = BASE32.indexOf(character);
    if (value === -1) throw new Error(`not a base32 secret: ${secret}`);
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return (binary % 1_000_000).toString().padStart(6, '0');
}

function currentStep(): number {
  return Math.floor(Date.now() / STEP_MS);
}

/** A code that is not valid at any step the API accepts now (current step ± 1). */
export function wrongCode(secret: string): string {
  const step = currentStep();
  const valid = new Set([step - 1, step, step + 1].map((at) => totpAt(secret, at)));
  for (let candidate = 0; ; candidate += 1) {
    const code = candidate.toString().padStart(6, '0');
    if (!valid.has(code)) return code;
  }
}

/**
 * The API accepts a code only for a step later than the last one used by the account (replay
 * rule), within one step of its clock. Each `nextCode` therefore uses the current step, or the
 * next one (still in the window) when the current one is spent, and waits for the clock only
 * when both are spent.
 */
export class TestAuthenticator {
  private lastStep = -1;

  constructor(readonly secret: string) {}

  async nextCode(): Promise<string> {
    let step = Math.max(currentStep(), this.lastStep + 1);
    while (step > currentStep() + 1) {
      const untilNextStep = STEP_MS - (Date.now() % STEP_MS) + 50;
      await new Promise((resolve) => setTimeout(resolve, untilNextStep));
      step = Math.max(currentStep(), this.lastStep + 1);
    }
    this.lastStep = step;
    return totpAt(this.secret, step);
  }
}
