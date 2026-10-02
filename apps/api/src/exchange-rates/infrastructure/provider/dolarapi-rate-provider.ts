import { RateProviderFailure } from '../../domain/errors';
import type { RateQuote } from '../../domain/rate-quote';
import type { RateProvider } from '../../application/ports/rate-provider';
import { mapDolarapiPayload, parseDolarapiJson } from './dolarapi-payload';

const MAX_BODY_BYTES = 65_536;
const JSON_CONTENT_TYPE = /^application\/(?:json|[\w.+-]+\+json)\s*(?:;.*)?$/i;

export interface DolarapiRateProviderOptions {
  baseUrl: string;
  /** Must stay well below the 5-minute refresh lease (LEASE_MS), or a slow call outlives its lease. */
  timeoutMs?: number;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function invalidPayload(detail: string): RateProviderFailure {
  return new RateProviderFailure('provider_invalid_payload', { detail });
}

/** Reads at most MAX_BODY_BYTES; a longer body is rejected as soon as the cap is crossed. */
async function readCapped(response: Response): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && BigInt(declared) > BigInt(MAX_BODY_BYTES)) {
    await response.body?.cancel().catch(() => undefined);
    throw invalidPayload('body too large');
  }
  if (!response.body) return '';

  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw invalidPayload('body too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** dolarapi.com adapter; bodies are never logged or stored. */
export class DolarapiRateProvider implements RateProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: DolarapiRateProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async fetchQuotes(): Promise<RateQuote[]> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/dolares`, {
        redirect: 'manual',
        signal,
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      throw new RateProviderFailure(isAbort(error) ? 'provider_timeout' : 'provider_unreachable');
    }

    if (response.status < 200 || response.status > 299) {
      await response.body?.cancel().catch(() => undefined);
      throw new RateProviderFailure('provider_bad_status', { statusCode: response.status });
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!JSON_CONTENT_TYPE.test(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      throw invalidPayload('content type is not JSON');
    }

    let text: string;
    try {
      text = await readCapped(response);
    } catch (error) {
      if (error instanceof RateProviderFailure) throw error;
      throw new RateProviderFailure(isAbort(error) ? 'provider_timeout' : 'provider_unreachable');
    }
    return mapDolarapiPayload(parseDolarapiJson(text));
  }
}
