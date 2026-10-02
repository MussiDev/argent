import { parseScaledRate, type RateType } from '@pesly/shared';
import { RateProviderFailure } from '../../domain/errors';
import { assertCompleteQuotes, type RateQuote } from '../../domain/rate-quote';

const CASA_TO_RATE_TYPE: Readonly<Record<string, RateType>> = {
  oficial: 'oficial',
  blue: 'blue',
  bolsa: 'mep',
  contadoconliqui: 'ccl',
  mayorista: 'mayorista',
  cripto: 'cripto',
  tarjeta: 'tarjeta',
};

/** The exact source text of a JSON number; a JSON string can never produce an instance. */
class PriceSource {
  constructor(readonly text: string | undefined) {}
}

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const PRICE_KEYS: ReadonlySet<string> = new Set(['compra', 'venta']);

function invalid(detail: string): RateProviderFailure {
  return new RateProviderFailure('provider_invalid_payload', { detail });
}

function priceReviver(key: string, value: unknown, context?: { source?: string }): unknown {
  // V8 still parses a float here and the result is discarded; only the source text is used.
  if (PRICE_KEYS.has(key) && typeof value === 'number') return new PriceSource(context?.source);
  return value;
}

/** Parses the response text, keeping the source text of every `compra` and `venta` number. */
export function parseDolarapiJson(text: string): unknown {
  try {
    return JSON.parse(text, priceReviver);
  } catch {
    throw invalid('body is not valid JSON');
  }
}

function toPrice(casa: string, field: string, value: unknown): bigint {
  if (!(value instanceof PriceSource) || value.text === undefined) {
    throw invalid(`${casa}: ${field} is not a JSON number`);
  }
  const scaled = parseScaledRate(value.text);
  if (scaled === null) throw invalid(`${casa}: ${field} is not a valid rate`);
  return scaled;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Maps the parsed array to the 7 quotes, one per rate type, or throws `provider_invalid_payload`. */
export function mapDolarapiPayload(parsed: unknown): RateQuote[] {
  if (!Array.isArray(parsed)) throw invalid('top level is not an array');

  const quotes: RateQuote[] = [];
  for (const entry of parsed as unknown[]) {
    if (!isRecord(entry)) throw invalid('entry is not an object');
    const casa = entry['casa'];
    if (typeof casa !== 'string') throw invalid('entry without a casa');
    if (!Object.hasOwn(CASA_TO_RATE_TYPE, casa)) continue;
    const rateType = CASA_TO_RATE_TYPE[casa];
    if (rateType === undefined) continue;

    if (entry['moneda'] !== 'USD') throw invalid(`${casa}: moneda is not USD`);
    const updated = entry['fechaActualizacion'];
    const providerUpdatedAt = new Date(
      typeof updated === 'string' && ISO_DATE_TIME.test(updated) ? updated : '',
    );
    if (isNaN(providerUpdatedAt.getTime())) {
      throw invalid(`${casa}: fechaActualizacion is not a valid date`);
    }
    quotes.push({
      rateType,
      buy: toPrice(casa, 'compra', entry['compra']),
      sell: toPrice(casa, 'venta', entry['venta']),
      providerUpdatedAt,
    });
  }

  return assertCompleteQuotes(quotes);
}
