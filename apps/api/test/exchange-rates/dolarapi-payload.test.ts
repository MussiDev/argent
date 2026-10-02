import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RateProviderFailure } from '../../src/exchange-rates/domain/errors';
import {
  mapDolarapiPayload,
  parseDolarapiJson,
} from '../../src/exchange-rates/infrastructure/provider/dolarapi-payload';

const fixtureText = readFileSync(join(__dirname, 'fixtures', 'dolarapi-2026-10-02.json'), 'utf8');

function entries(): Record<string, unknown>[] {
  const parsed: unknown = JSON.parse(fixtureText);
  return parsed as Record<string, unknown>[];
}

// Goes through the same source-preserving parse as production.
function map(list: unknown[]) {
  return mapDolarapiPayload(parseDolarapiJson(JSON.stringify(list)));
}

function failure(run: () => unknown): RateProviderFailure {
  try {
    run();
  } catch (error) {
    if (error instanceof RateProviderFailure) return error;
    throw error;
  }
  throw new Error('expected a RateProviderFailure');
}

function withEntry(casa: string, patch: Record<string, unknown>): unknown[] {
  return entries().map((entry) => (entry['casa'] === casa ? { ...entry, ...patch } : entry));
}

describe('dolarapi payload mapping', () => {
  it('maps the 2026-10-02 fixture to 7 quotes with exact scaled values', () => {
    const quotes = mapDolarapiPayload(parseDolarapiJson(fixtureText));
    expect(quotes).toHaveLength(7);
    const ccl = quotes.find((q) => q.rateType === 'ccl');
    expect(ccl?.buy).toBe(16233000n);
    expect(ccl?.sell).toBe(16248000n);
    expect(quotes.find((q) => q.rateType === 'tarjeta')?.sell).toBe(20085000n);
    expect(quotes.find((q) => q.rateType === 'cripto')?.buy).toBe(16140300n);
    expect(quotes.find((q) => q.rateType === 'oficial')?.providerUpdatedAt.toISOString()).toBe(
      '2026-10-01T18:55:00.000Z',
    );
  });

  it('maps bolsa to mep and contadoconliqui to ccl, and ignores an unknown casa', () => {
    const extra = [
      ...entries(),
      { moneda: 'USD', casa: 'nueva', compra: 1, venta: 2, fechaActualizacion: 'x' },
    ];
    const quotes = map(extra);
    expect(quotes.map((q) => q.rateType).sort()).toEqual(
      ['blue', 'ccl', 'cripto', 'mayorista', 'mep', 'oficial', 'tarjeta'].sort(),
    );
    expect(quotes.find((q) => q.rateType === 'mep')?.buy).toBe(15470000n);
  });

  it.each([
    ['null compra', 'blue', { compra: null }],
    ['negative price', 'bolsa', { venta: -5 }],
    ['string price', 'cripto', { compra: '1500' }],
  ])('rejects a %s naming the casa', (_name, casa, patch) => {
    const error = failure(() => map(withEntry(casa, patch)));
    expect(error.code).toBe('provider_invalid_payload');
    expect(error.detail).toContain(casa);
  });

  it('rejects a missing venta naming the casa', () => {
    const list = entries().map((entry) => {
      if (entry['casa'] !== 'mayorista') return entry;
      const rest = { ...entry };
      delete rest['venta'];
      return rest;
    });
    const error = failure(() => map(list));
    expect(error.code).toBe('provider_invalid_payload');
    expect(error.detail).toContain('mayorista');
  });

  it('rejects a missing type, a duplicate casa and a moneda other than USD', () => {
    const missing = failure(() => map(entries().filter((e) => e['casa'] !== 'tarjeta')));
    expect(missing.code).toBe('provider_invalid_payload');
    const duplicate = failure(() => map([...entries(), entries()[0]]));
    expect(duplicate.code).toBe('provider_invalid_payload');
    expect(duplicate.detail).toContain('oficial');
    const moneda = failure(() => map(withEntry('blue', { moneda: 'EUR' })));
    expect(moneda.code).toBe('provider_invalid_payload');
    expect(moneda.detail).toContain('blue');
  });

  it('rejects an unparseable fechaActualizacion', () => {
    const bad = failure(() => map(withEntry('contadoconliqui', { fechaActualizacion: 'nope' })));
    expect(bad.code).toBe('provider_invalid_payload');
    expect(bad.detail).toContain('contadoconliqui');
  });

  it('rejects a non-array top level and invalid JSON', () => {
    expect(failure(() => mapDolarapiPayload(parseDolarapiJson('{"a":1}'))).code).toBe(
      'provider_invalid_payload',
    );
    expect(failure(() => parseDolarapiJson('{not json')).code).toBe('provider_invalid_payload');
  });
});

describe('dolarapi payload hardening', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'ignores the inherited-property casa %s as unknown',
    (casa) => {
      const extra = { moneda: 'USD', casa, compra: 1, venta: 2, fechaActualizacion: 'x' };
      expect(map([extra, ...entries()])).toHaveLength(7);
    },
  );

  it.each(['2026', '1', '10/02/2026', 'Fri Oct 02 2026', '2026-10-02', '2026-10-02 11:56:00'])(
    'rejects the non-ISO date-time %s',
    (value) => {
      const error = failure(() => map(withEntry('blue', { fechaActualizacion: value })));
      expect(error.code).toBe('provider_invalid_payload');
      expect(error.detail).toContain('blue');
    },
  );

  it.each(['2026-10-02T11:56:00.000Z', '2026-10-02T11:56:00Z', '2026-10-02T08:56:00-03:00'])(
    'accepts the ISO date-time %s',
    (value) => {
      const quotes = map(withEntry('blue', { fechaActualizacion: value }));
      expect(quotes.find((q) => q.rateType === 'blue')?.providerUpdatedAt.toISOString()).toBe(
        '2026-10-02T11:56:00.000Z',
      );
    },
  );
});

describe('dolarapi price parsing through the mapper', () => {
  function withRawCompra(raw: string): string {
    return fixtureText.replace(/"compra": 1495/, `"compra": ${raw}`);
  }

  it.each(['1e3', '10000001', '0', '-0'])('rejects the price text %s', (raw) => {
    const error = failure(() => mapDolarapiPayload(parseDolarapiJson(withRawCompra(raw))));
    expect(error.code).toBe('provider_invalid_payload');
    expect(error.detail).toContain('oficial');
  });

  it('rounds the fifth decimal half up and keeps a trailing zero exact', () => {
    const rounded = mapDolarapiPayload(parseDolarapiJson(withRawCompra('1495.00005')));
    expect(rounded.find((q) => q.rateType === 'oficial')?.buy).toBe(14950001n);
    const exact = mapDolarapiPayload(parseDolarapiJson(withRawCompra('1495.0')));
    expect(exact.find((q) => q.rateType === 'oficial')?.buy).toBe(14950000n);
  });

  it('fails closed when the payload was parsed without the reviver', () => {
    const error = failure(() => mapDolarapiPayload(JSON.parse(fixtureText)));
    expect(error.code).toBe('provider_invalid_payload');
  });
});
