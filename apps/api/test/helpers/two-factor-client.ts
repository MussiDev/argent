import type { Express } from 'express';
import request, { type Response } from 'supertest';
import type { Clock } from '../../src/identity/application/ports/clock';
import {
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from '../../src/identity/domain/recovery-code';
import { DrizzleRecoveryCodeRepository } from '../../src/identity/infrastructure/db/drizzle-recovery-code-repository';
import { DrizzleTwoFactorRepository } from '../../src/identity/infrastructure/db/drizzle-two-factor-repository';
import { AesGcmSecretBox } from '../../src/identity/infrastructure/security/aes-gcm-secret-box';
import { Argon2idPasswordHasher } from '../../src/identity/infrastructure/security/argon2id-password-hasher';
import { CryptoRecoveryCodeGenerator } from '../../src/identity/infrastructure/security/crypto-recovery-code-generator';
import { hotp, RfcTotpEngine } from '../../src/identity/infrastructure/security/totp';
import type { DatabaseConnection } from '../../src/shared/db/client';
import { parseSetCookies } from './session-client';
import { TEST_TOTP_ENCRYPTION_KEY, trustedHeaders } from './test-env';

export const CHALLENGE_COOKIE = '__Secure-argent_mfa';
export const STEP_MS = 30_000;

/** The challenge token a first factor set, read from its `Set-Cookie`. */
export function challengeFrom(response: Response): string {
  const value = parseSetCookies(response).get(CHALLENGE_COOKIE)?.value;
  if (!value) throw new Error(`Response ${response.status} did not set the challenge cookie`);
  return value;
}

/** `POST /auth/2fa/verify`, with the challenge cookie when one is given. */
export function verifySecondFactor(app: Express, challenge: string | undefined, code: unknown) {
  const call = request(app).post('/auth/2fa/verify').set(trustedHeaders);
  if (challenge !== undefined) call.set('Cookie', `${CHALLENGE_COOKIE}=${challenge}`);
  return call.send({ code });
}

export function stepAt(clock: Clock): number {
  return Math.floor(clock.now().getTime() / STEP_MS);
}

/** The code an authenticator shows for `secret` at the clock's current time. */
export function totpNow(secret: string, clock: Clock): string {
  return hotp(secret, stepAt(clock));
}

/** A 6-digit code that matches none of the steps the engine accepts right now. */
export function wrongTotp(secret: string, clock: Clock): string {
  const step = stepAt(clock);
  const valid = new Set([step - 1, step, step + 1].map((s) => hotp(secret, s)));
  for (let n = 0; ; n += 1) {
    const candidate = String(n).padStart(6, '0');
    if (!valid.has(candidate)) return candidate;
  }
}

/** A well-formed recovery code that is never issued (`U` is not in the alphabet, but `0` is). */
export const UNKNOWN_RECOVERY_CODE = '00000-00000';

export interface SeededTwoFactor {
  secret: string;
  /** In display form, in the order they were stored. */
  recoveryCodes: string[];
  /** The display form of each stored hash, to find the code of a given row. */
  codeForHash: ReadonlyMap<string, string>;
}

interface HashedCodes {
  codes: string[];
  hashes: string[];
}

let cachedCodes: Promise<HashedCodes> | undefined;

/** Argon2id is slow on purpose: one set of 10 codes is hashed once per test run and reused. */
function hashedCodes(): Promise<HashedCodes> {
  cachedCodes ??= (async () => {
    const hasher = new Argon2idPasswordHasher();
    const codes = new CryptoRecoveryCodeGenerator().generate(RECOVERY_CODE_COUNT);
    const hashes: string[] = [];
    for (const code of codes) {
      const stored = normalizeRecoveryCode(code);
      if (stored === null) throw new Error('generated recovery code does not normalize');
      hashes.push(await hasher.hash(stored));
    }
    return { codes, hashes };
  })();
  return cachedCodes;
}

/**
 * Turns 2FA on for `userId` straight through the repositories, as a confirmed enable leaves it:
 * a sealed secret, enabled, and 10 unused recovery codes (stored only as Argon2id hashes).
 */
export async function seedTwoFactor(
  connection: DatabaseConnection,
  userId: string,
  clock: Clock,
): Promise<SeededTwoFactor> {
  const totp = new RfcTotpEngine();
  const secret = totp.generateSecret();
  const sealed = new AesGcmSecretBox(TEST_TOTP_ENCRYPTION_KEY).seal(secret, userId);
  const twoFactor = new DrizzleTwoFactorRepository(connection.db);
  if (!(await twoFactor.savePending(userId, sealed))) throw new Error('2FA already enabled');
  if (!(await twoFactor.activate(userId, sealed, clock.now()))) throw new Error('not activated');
  const { codes, hashes } = await hashedCodes();
  await new DrizzleRecoveryCodeRepository(connection.db).replaceAll(userId, hashes);
  return {
    secret,
    recoveryCodes: codes,
    codeForHash: new Map(hashes.map((hash, index) => [hash, codes[index] ?? ''])),
  };
}

export async function unusedRecoveryCodes(
  connection: DatabaseConnection,
  userId: string,
): Promise<number> {
  return new DrizzleRecoveryCodeRepository(connection.db).countUnused(userId);
}
