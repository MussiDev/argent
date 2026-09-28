import { errors, jwtVerify, SignJWT } from 'jose';
import type {
  AccessTokenClaims,
  AccessTokenIssuer,
} from '../../application/ports/access-token-issuer';
import type { Clock } from '../../application/ports/clock';

const ALGORITHM = 'HS256';
const TOKEN_TYPE = 'JWT';
/** Who issues access tokens and what they are for: a token minted for anything else is refused. */
export const ACCESS_TOKEN_ISSUER = 'argent-api';
export const ACCESS_TOKEN_AUDIENCE = 'argent-access';
/** Skew allowed between API instances' clocks when checking `exp`, `iat` and token age. */
const CLOCK_TOLERANCE = '5s';
/** NFR-05: access tokens live 15 minutes; the refresh token renews them. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** HS256 needs a key at least as long as its output (R-14). */
const MIN_SECRET_BYTES = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface JoseAccessTokenIssuerOptions {
  secret: string;
  clock: Clock;
}

function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export class JoseAccessTokenIssuer implements AccessTokenIssuer {
  readonly ttlSeconds = ACCESS_TOKEN_TTL_SECONDS;
  private readonly key: Uint8Array;
  private readonly clock: Clock;

  constructor({ secret, clock }: JoseAccessTokenIssuerOptions) {
    this.key = new TextEncoder().encode(secret);
    if (this.key.byteLength < MIN_SECRET_BYTES) {
      throw new Error(`The JWT secret must be at least ${MIN_SECRET_BYTES} bytes`);
    }
    this.clock = clock;
  }

  issue({ userId, sessionId }: AccessTokenClaims): Promise<string> {
    const issuedAt = epochSeconds(this.clock.now());
    return new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: ALGORITHM, typ: TOKEN_TYPE })
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setSubject(userId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + this.ttlSeconds)
      .sign(this.key);
  }

  async verify(token: string): Promise<AccessTokenClaims | null> {
    try {
      // `algorithms` pins HS256: `none`, other HMAC sizes and asymmetric algorithms are refused.
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [ALGORITHM],
        typ: TOKEN_TYPE,
        issuer: ACCESS_TOKEN_ISSUER,
        audience: ACCESS_TOKEN_AUDIENCE,
        // Bounds the token by its `iat` too, so a long `exp` cannot outlive the 15 minutes.
        maxTokenAge: `${ACCESS_TOKEN_TTL_SECONDS}s`,
        clockTolerance: CLOCK_TOLERANCE,
        currentDate: this.clock.now(),
        requiredClaims: ['sub', 'sid', 'exp', 'iat'],
      });
      const { sub, sid } = payload;
      if (
        typeof sub !== 'string' ||
        typeof sid !== 'string' ||
        !UUID.test(sub) ||
        !UUID.test(sid)
      ) {
        return null;
      }
      return { userId: sub, sessionId: sid };
    } catch (error) {
      // Every JOSE error means "not a token we accept"; anything else is a real failure.
      if (error instanceof errors.JOSEError) return null;
      throw error;
    }
  }
}
