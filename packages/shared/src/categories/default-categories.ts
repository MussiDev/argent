import type { CategoryColor, CategoryIcon, CategoryKind, CategoryLanguage } from './category';

export interface DefaultCategory {
  key: string;
  kind: CategoryKind;
  parentKey: string | null;
  names: { es: string; en: string };
  icon: CategoryIcon;
  color: CategoryColor;
}

interface Root {
  key: string;
  kind: CategoryKind;
  es: string;
  en: string;
  icon: CategoryIcon;
  color: CategoryColor;
  children?: { key: string; es: string; en: string }[];
}

const ROOTS: Root[] = [
  {
    key: 'food',
    kind: 'expense',
    es: 'Comida',
    en: 'Food',
    icon: 'utensils',
    color: 'orange',
    children: [
      { key: 'groceries', es: 'Supermercado', en: 'Groceries' },
      { key: 'restaurants', es: 'Restaurantes', en: 'Restaurants' },
      { key: 'delivery', es: 'Delivery', en: 'Delivery' },
    ],
  },
  {
    key: 'transport',
    kind: 'expense',
    es: 'Transporte',
    en: 'Transport',
    icon: 'car',
    color: 'blue',
    children: [
      { key: 'fuel', es: 'Nafta', en: 'Fuel' },
      { key: 'public-transport', es: 'Transporte público', en: 'Public transport' },
      { key: 'ride-hailing', es: 'Apps de viaje', en: 'Ride-hailing' },
      { key: 'parking', es: 'Estacionamiento', en: 'Parking' },
    ],
  },
  {
    key: 'home',
    kind: 'expense',
    es: 'Hogar',
    en: 'Home',
    icon: 'home',
    color: 'amber',
    children: [
      { key: 'rent', es: 'Alquiler', en: 'Rent' },
      { key: 'utilities', es: 'Servicios', en: 'Utilities' },
      { key: 'maintenance', es: 'Mantenimiento', en: 'Maintenance' },
    ],
  },
  {
    key: 'health',
    kind: 'expense',
    es: 'Salud',
    en: 'Health',
    icon: 'heart-pulse',
    color: 'red',
    children: [
      { key: 'health-insurance', es: 'Prepaga', en: 'Health insurance' },
      { key: 'pharmacy', es: 'Farmacia', en: 'Pharmacy' },
      { key: 'doctor', es: 'Médico', en: 'Doctor' },
    ],
  },
  {
    key: 'entertainment',
    kind: 'expense',
    es: 'Entretenimiento',
    en: 'Entertainment',
    icon: 'clapperboard',
    color: 'violet',
    children: [
      { key: 'outings', es: 'Salidas', en: 'Outings' },
      { key: 'streaming', es: 'Streaming', en: 'Streaming' },
      { key: 'hobbies', es: 'Hobbies', en: 'Hobbies' },
    ],
  },
  {
    key: 'shopping',
    kind: 'expense',
    es: 'Compras',
    en: 'Shopping',
    icon: 'shopping-bag',
    color: 'pink',
    children: [
      { key: 'clothing', es: 'Ropa', en: 'Clothing' },
      { key: 'electronics', es: 'Electrónica', en: 'Electronics' },
      { key: 'gifts', es: 'Regalos', en: 'Gifts' },
    ],
  },
  {
    key: 'education',
    kind: 'expense',
    es: 'Educación',
    en: 'Education',
    icon: 'graduation-cap',
    color: 'cyan',
  },
  {
    key: 'taxes',
    kind: 'expense',
    es: 'Impuestos y comisiones',
    en: 'Taxes & fees',
    icon: 'receipt',
    color: 'slate',
  },
  {
    key: 'other-expenses',
    kind: 'expense',
    es: 'Otros gastos',
    en: 'Other expenses',
    icon: 'ellipsis',
    color: 'slate',
  },
  {
    key: 'salary',
    kind: 'income',
    es: 'Sueldo',
    en: 'Salary',
    icon: 'banknote',
    color: 'green',
  },
  {
    key: 'freelance',
    kind: 'income',
    es: 'Freelance',
    en: 'Freelance',
    icon: 'laptop',
    color: 'teal',
  },
  {
    key: 'investment-returns',
    kind: 'income',
    es: 'Rendimientos de inversiones',
    en: 'Investment returns',
    icon: 'trending-up',
    color: 'lime',
  },
  {
    key: 'gifts-received',
    kind: 'income',
    es: 'Regalos recibidos',
    en: 'Gifts received',
    icon: 'gift',
    color: 'pink',
  },
  {
    key: 'other-income',
    kind: 'income',
    es: 'Otros ingresos',
    en: 'Other income',
    icon: 'ellipsis',
    color: 'slate',
  },
];

/** Parents come before their children; a subcategory inherits its parent's icon and color. */
export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = ROOTS.flatMap((root) => [
  {
    key: root.key,
    kind: root.kind,
    parentKey: null,
    names: { es: root.es, en: root.en },
    icon: root.icon,
    color: root.color,
  },
  ...(root.children ?? []).map((child) => ({
    key: `${root.key}.${child.key}`,
    kind: root.kind,
    parentKey: root.key,
    names: { es: child.es, en: child.en },
    icon: root.icon,
    color: root.color,
  })),
]);

function findDefault(key: string): DefaultCategory {
  const entry = DEFAULT_CATEGORIES.find((candidate) => candidate.key === key);
  if (entry === undefined) throw new Error(`Unknown default category key: ${key}`);
  return entry;
}

export function defaultCategoryNames(key: string): { es: string; en: string } {
  return { ...findDefault(key).names };
}

export function defaultCategoryName(key: string, language: CategoryLanguage): string {
  return findDefault(key).names[language];
}
