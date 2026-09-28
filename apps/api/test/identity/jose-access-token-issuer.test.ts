import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { JoseAccessTokenIssuer } from '../../src/identity/infrastructure/security/jose-access-token-issuer';
import { MutableClock } from '../fakes/mutable-clock';

const SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';
const KEY = new TextEncoder().encode(SECRET);
const NOW = new Date('2026-09-26T12:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

interface ForgedToken {
  issuer?: string;
  audience?: string;
  typ?: string;
  issuedAt?: number;
  expiresAt?: number;
}

/** A token signed with the right secret and algorithm, but with the given claims and header. */
function forge({
  issuer = 'argent-api',
  audience = 'argent-access',
  typ = 'JWT',
  issuedAt = NOW_SECONDS,
  expiresAt = NOW_SECONDS + 15 * 60,
}: ForgedToken): Promise<string> {
  return new SignJWT({ sid: randomUUID() })
    .setProtectedHeader({ alg: 'HS256', typ })
    .setSubject(randomUUID())
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(KEY);
}

function decode(token: string, index: number): Record<string, unknown> {
  const part = token.split('.')[index] ?? '';
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('JoseAccessTokenIssuer', () => {
  it('issues an HS256 JWT with sub, sid and a 15-minute expiry, and verifies it', async () => {
    const clock = new MutableClock(new Date('2026-09-26T12:00:00.000Z'));
    const issuer = new JoseAccessTokenIssuer({ secret: SECRET, clock });
    const claims = { userId: randomUUID(), sessionId: randomUUID() };

    const token = await issuer.issue(claims);

    expect(decode(token, 0)).toEqual({ alg: 'HS256', typ: 'JWT' });
    const payload = decode(token, 1);
    expect(payload).toMatchObject({
      sub: claims.userId,
      sid: claims.sessionId,
      iss: 'argent-api',
      aud: 'argent-access',
    });
    expect(Number(payload.exp) - Number(payload.iat)).toBe(15 * 60);
    expect(await issuer.verify(token)).toEqual(claims);
  });

  it('rejects the token once expired, and a token signed with another secret', async () => {
    const clock = new MutableClock(new Date('2026-09-26T12:00:00.000Z'));
    const issuer = new JoseAccessTokenIssuer({ secret: SECRET, clock });
    const other = new JoseAccessTokenIssuer({ secret: `${SECRET}-other`, clock });
    const claims = { userId: randomUUID(), sessionId: randomUUID() };
    const token = await issuer.issue(claims);

    expect(await other.verify(token)).toBeNull();
    // Still accepted inside the 5-second clock tolerance, refused after it.
    clock.advance(15 * 60 * 1000 + 4000);
    expect(await issuer.verify(token)).toEqual(claims);
    clock.advance(2000);
    expect(await issuer.verify(token)).toBeNull();
  });

  it('rejects alg:none and malformed tokens without throwing (R-14)', async () => {
    const issuer = new JoseAccessTokenIssuer({ secret: SECRET, clock: new MutableClock() });
    const payload = Buffer.from(
      JSON.stringify({ sub: randomUUID(), sid: randomUUID(), exp: 9999999999 }),
    ).toString('base64url');
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');

    expect(await issuer.verify(`${header}.${payload}.`)).toBeNull();
    expect(await issuer.verify('a.b.c')).toBeNull();
    expect(await issuer.verify('')).toBeNull();
  });

  it('rejects a correctly signed token with the wrong issuer, audience or typ (A-3)', async () => {
    const issuer = new JoseAccessTokenIssuer({ secret: SECRET, clock: new MutableClock(NOW) });

    expect(await issuer.verify(await forge({}))).not.toBeNull();
    expect(await issuer.verify(await forge({ issuer: 'someone-else' }))).toBeNull();
    expect(await issuer.verify(await forge({ audience: 'argent-refresh' }))).toBeNull();
    expect(await issuer.verify(await forge({ typ: 'at+jwt' }))).toBeNull();
  });

  it('rejects a token issued more than 15 minutes ago even if its exp is later (maxTokenAge)', async () => {
    const issuer = new JoseAccessTokenIssuer({ secret: SECRET, clock: new MutableClock(NOW) });

    const longLived = await forge({
      issuedAt: NOW_SECONDS - 16 * 60,
      expiresAt: NOW_SECONDS + 24 * 60 * 60,
    });

    expect(await issuer.verify(longLived)).toBeNull();
  });

  it('refuses a secret shorter than 256 bits', () => {
    expect(
      () => new JoseAccessTokenIssuer({ secret: 'short', clock: new MutableClock() }),
    ).toThrow();
  });
});
