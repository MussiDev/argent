import { describe, expect, it } from 'vitest';
import {
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  DEFAULT_CATEGORIES,
  defaultCategoryName,
  defaultCategoryNames,
  displayCategoryName,
} from '@pesly/shared';

const EXPECTED: [string, string, string, string | null][] = [
  // key, kind, es, parentKey
  ['food', 'expense', 'Comida', null],
  ['food.groceries', 'expense', 'Supermercado', 'food'],
  ['food.restaurants', 'expense', 'Restaurantes', 'food'],
  ['food.delivery', 'expense', 'Delivery', 'food'],
  ['transport', 'expense', 'Transporte', null],
  ['transport.fuel', 'expense', 'Nafta', 'transport'],
  ['transport.public-transport', 'expense', 'Transporte público', 'transport'],
  ['transport.ride-hailing', 'expense', 'Apps de viaje', 'transport'],
  ['transport.parking', 'expense', 'Estacionamiento', 'transport'],
  ['home', 'expense', 'Hogar', null],
  ['home.rent', 'expense', 'Alquiler', 'home'],
  ['home.utilities', 'expense', 'Servicios', 'home'],
  ['home.maintenance', 'expense', 'Mantenimiento', 'home'],
  ['health', 'expense', 'Salud', null],
  ['health.health-insurance', 'expense', 'Prepaga', 'health'],
  ['health.pharmacy', 'expense', 'Farmacia', 'health'],
  ['health.doctor', 'expense', 'Médico', 'health'],
  ['entertainment', 'expense', 'Entretenimiento', null],
  ['entertainment.outings', 'expense', 'Salidas', 'entertainment'],
  ['entertainment.streaming', 'expense', 'Streaming', 'entertainment'],
  ['entertainment.hobbies', 'expense', 'Hobbies', 'entertainment'],
  ['shopping', 'expense', 'Compras', null],
  ['shopping.clothing', 'expense', 'Ropa', 'shopping'],
  ['shopping.electronics', 'expense', 'Electrónica', 'shopping'],
  ['shopping.gifts', 'expense', 'Regalos', 'shopping'],
  ['education', 'expense', 'Educación', null],
  ['taxes', 'expense', 'Impuestos y comisiones', null],
  ['other-expenses', 'expense', 'Otros gastos', null],
  ['salary', 'income', 'Sueldo', null],
  ['freelance', 'income', 'Freelance', null],
  ['investment-returns', 'income', 'Rendimientos de inversiones', null],
  ['gifts-received', 'income', 'Regalos recibidos', null],
  ['other-income', 'income', 'Otros ingresos', null],
];

describe('DEFAULT_CATEGORIES', () => {
  it('has exactly the 33 Appendix A entries with unique keys', () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(33);
    expect(new Set(DEFAULT_CATEGORIES.map((c) => c.key)).size).toBe(33);
    expect(DEFAULT_CATEGORIES.map((c) => c.key)).toEqual(EXPECTED.map(([key]) => key));
  });

  it('has 9 expense roots, 19 expense subcategories and 5 income roots', () => {
    const expense = DEFAULT_CATEGORIES.filter((c) => c.kind === 'expense');
    const income = DEFAULT_CATEGORIES.filter((c) => c.kind === 'income');
    expect(expense.filter((c) => c.parentKey === null)).toHaveLength(9);
    expect(expense.filter((c) => c.parentKey !== null)).toHaveLength(19);
    expect(income.filter((c) => c.parentKey === null)).toHaveLength(5);
    expect(income.filter((c) => c.parentKey !== null)).toHaveLength(0);
  });

  it.each(EXPECTED)('%s has kind %s, Spanish name %s and parent %s', (key, kind, es, parentKey) => {
    const entry = DEFAULT_CATEGORIES.find((c) => c.key === key);
    expect(entry?.kind).toBe(kind);
    expect(entry?.names.es).toBe(es);
    expect(entry?.parentKey).toBe(parentKey);
    expect(entry?.names.en.length).toBeGreaterThan(0);
  });

  it('has the English names of Appendix A', () => {
    expect(DEFAULT_CATEGORIES.map((c) => c.names.en)).toEqual([
      'Food',
      'Groceries',
      'Restaurants',
      'Delivery',
      'Transport',
      'Fuel',
      'Public transport',
      'Ride-hailing',
      'Parking',
      'Home',
      'Rent',
      'Utilities',
      'Maintenance',
      'Health',
      'Health insurance',
      'Pharmacy',
      'Doctor',
      'Entertainment',
      'Outings',
      'Streaming',
      'Hobbies',
      'Shopping',
      'Clothing',
      'Electronics',
      'Gifts',
      'Education',
      'Taxes & fees',
      'Other expenses',
      'Salary',
      'Freelance',
      'Investment returns',
      'Gifts received',
      'Other income',
    ]);
  });

  it('parents exist, come first, share the kind and are roots', () => {
    const seen = new Map<string, (typeof DEFAULT_CATEGORIES)[number]>();
    for (const entry of DEFAULT_CATEGORIES) {
      if (entry.parentKey !== null) {
        const parent = seen.get(entry.parentKey);
        expect(parent).toBeDefined();
        expect(parent?.parentKey).toBeNull();
        expect(parent?.kind).toBe(entry.kind);
        expect(entry.key.startsWith(`${entry.parentKey}.`)).toBe(true);
        expect(entry.icon).toBe(parent?.icon);
        expect(entry.color).toBe(parent?.color);
      }
      seen.set(entry.key, entry);
    }
  });

  it('only references icons and colors from the fixed lists', () => {
    for (const entry of DEFAULT_CATEGORIES) {
      expect(CATEGORY_ICONS).toContain(entry.icon);
      expect(CATEGORY_COLORS).toContain(entry.color);
    }
  });

  it('has names that are unique per kind and parent in both languages', () => {
    // es and en of one entry may be equal (Delivery), so compare the set of names per entry.
    const namesOf = (entry: (typeof DEFAULT_CATEGORIES)[number]): Set<string> =>
      new Set([entry.names.es.toLowerCase(), entry.names.en.toLowerCase()]);
    DEFAULT_CATEGORIES.forEach((entry, index) => {
      const names = namesOf(entry);
      const siblings = DEFAULT_CATEGORIES.filter(
        (other, otherIndex) =>
          otherIndex !== index && other.kind === entry.kind && other.parentKey === entry.parentKey,
      );
      for (const sibling of siblings) {
        for (const name of namesOf(sibling)) {
          expect(names.has(name), `${entry.key} clashes with ${sibling.key}`).toBe(false);
        }
      }
    });
  });
});

describe('default names', () => {
  it('resolves Spanish and English names', () => {
    expect(defaultCategoryName('food', 'es')).toBe('Comida');
    expect(defaultCategoryName('food.groceries', 'es')).toBe('Supermercado');
    expect(defaultCategoryName('food', 'en')).toBe('Food');
    expect(defaultCategoryName('food.groceries', 'en')).toBe('Groceries');
  });

  it('returns both languages', () => {
    expect(defaultCategoryNames('food.groceries')).toEqual({
      es: 'Supermercado',
      en: 'Groceries',
    });
  });

  it('throws for an unknown key', () => {
    expect(() => defaultCategoryName('nope', 'es')).toThrow('Unknown default category key: nope');
    expect(() => defaultCategoryNames('nope')).toThrow('Unknown default category key: nope');
  });
});

describe('displayCategoryName', () => {
  it('returns the custom name in both languages when there is no key', () => {
    expect(displayCategoryName({ key: null, name: 'Mascotas' }, 'es')).toBe('Mascotas');
    expect(displayCategoryName({ key: null, name: 'Mascotas' }, 'en')).toBe('Mascotas');
  });

  it('translates an untouched default', () => {
    expect(displayCategoryName({ key: 'food', name: null }, 'es')).toBe('Comida');
    expect(displayCategoryName({ key: 'food', name: null }, 'en')).toBe('Food');
  });

  it('keeps the renamed name of a default in both languages', () => {
    expect(displayCategoryName({ key: 'food', name: 'Mercado' }, 'es')).toBe('Mercado');
    expect(displayCategoryName({ key: 'food', name: 'Mercado' }, 'en')).toBe('Mercado');
  });

  it('throws when there is neither a key nor a name', () => {
    expect(() => displayCategoryName({ key: null, name: null }, 'es')).toThrow(
      'A category without a name must have a default key',
    );
  });
});
