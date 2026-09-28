import { createHash } from 'node:crypto';
import type { Logger } from '../../../shared/logging/logger';
import type { BreachedPasswordChecker } from '../../application/ports/breached-password-checker';
import { PasswordCheckUnavailable } from '../../domain/errors';

export const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
export const HIBP_TIMEOUT_MS = 400;

export interface HibpOptions {
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  logger?: Logger;
}

type FailureReason = 'timeout' | 'http_status' | 'network';

class HibpFailure extends Error {
  constructor(
    readonly reason: FailureReason,
    readonly status?: number,
  ) {
    super(`HIBP range request failed: ${reason}${status === undefined ? '' : ` ${status}`}`);
    this.name = 'HibpFailure';
  }
}

/**
 * Have I Been Pwned range API with k-anonymity: only the first 5 hex characters of the password's
 * SHA-1 leave the process; the suffix is matched locally. Fail-closed (threat R-07): a timeout
 * (400 ms for the whole exchange, body included), a non-200 answer or a network error rejects with
 * `PasswordCheckUnavailable`, never with "not breached".
 */
export class HibpBreachedPasswordChecker implements BreachedPasswordChecker {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly logger: Logger | undefined;

  constructor(options: HibpOptions = {}) {
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? HIBP_TIMEOUT_MS;
    this.logger = options.logger;
  }

  async isBreached(password: string): Promise<boolean> {
    const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const startedAt = performance.now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Raced as well as passed to fetch: the deadline holds even if a transport ignores the signal.
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const failure = new HibpFailure('timeout');
        controller.abort(failure);
        reject(failure);
      }, this.timeoutMs);
    });

    try {
      const body = await Promise.race([this.fetchRange(prefix, controller.signal), deadline]);
      return listsSuffix(body, suffix);
    } catch (error) {
      const failure = error instanceof HibpFailure ? error : new HibpFailure('network');
      this.logger?.warn(
        {
          provider: 'hibp',
          reason: failure.reason,
          status: failure.status,
          latencyMs: Math.round(performance.now() - startedAt),
        },
        'breached password check unavailable',
      );
      // The sanitized failure, not the raw fetch error: driver errors can embed the request URL,
      // which carries the password's hash prefix.
      throw new PasswordCheckUnavailable({ cause: failure });
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchRange(prefix: string, signal: AbortSignal): Promise<string> {
    const response = await this.fetchFn(`${HIBP_RANGE_URL}${prefix}`, {
      method: 'GET',
      // Padding hides the real size of the range from anyone observing the response.
      headers: { 'Add-Padding': 'true' },
      signal,
    });
    if (response.status !== 200) {
      // Release the connection instead of leaving an unread body to the garbage collector.
      await response.body?.cancel().catch((error: unknown) => {
        this.logger?.debug({ err: error }, 'could not cancel the HIBP response body');
      });
      throw new HibpFailure('http_status', response.status);
    }
    return response.text();
  }
}

/** Lines are `SUFFIX:COUNT`; padding entries have a count of 0 and are not breaches. */
function listsSuffix(body: string, suffix: string): boolean {
  for (const line of body.split('\n')) {
    const [candidate, count] = line.trim().split(':');
    if (candidate?.toUpperCase() === suffix && Number(count) > 0) return true;
  }
  return false;
}
