/**
 * FROZEN copy of the default set that `0009_categories.sql` backfills. A migration is history: the
 * live catalog in `packages/shared` may change later, this list must not, so it deliberately does
 * not import the catalog.
 */
export interface FrozenDefault {
  key: string;
  kind: 'expense' | 'income';
  parentKey: string | null;
  icon: string;
  color: string;
}

export const DEFAULT_SET_0009: readonly FrozenDefault[] = [
  { key: 'food', kind: 'expense', parentKey: null, icon: 'utensils', color: 'orange' },
  { key: 'food.groceries', kind: 'expense', parentKey: 'food', icon: 'utensils', color: 'orange' },
  {
    key: 'food.restaurants',
    kind: 'expense',
    parentKey: 'food',
    icon: 'utensils',
    color: 'orange',
  },
  { key: 'food.delivery', kind: 'expense', parentKey: 'food', icon: 'utensils', color: 'orange' },
  { key: 'transport', kind: 'expense', parentKey: null, icon: 'car', color: 'blue' },
  { key: 'transport.fuel', kind: 'expense', parentKey: 'transport', icon: 'car', color: 'blue' },
  {
    key: 'transport.public-transport',
    kind: 'expense',
    parentKey: 'transport',
    icon: 'car',
    color: 'blue',
  },
  {
    key: 'transport.ride-hailing',
    kind: 'expense',
    parentKey: 'transport',
    icon: 'car',
    color: 'blue',
  },
  { key: 'transport.parking', kind: 'expense', parentKey: 'transport', icon: 'car', color: 'blue' },
  { key: 'home', kind: 'expense', parentKey: null, icon: 'home', color: 'amber' },
  { key: 'home.rent', kind: 'expense', parentKey: 'home', icon: 'home', color: 'amber' },
  { key: 'home.utilities', kind: 'expense', parentKey: 'home', icon: 'home', color: 'amber' },
  { key: 'home.maintenance', kind: 'expense', parentKey: 'home', icon: 'home', color: 'amber' },
  { key: 'health', kind: 'expense', parentKey: null, icon: 'heart-pulse', color: 'red' },
  {
    key: 'health.health-insurance',
    kind: 'expense',
    parentKey: 'health',
    icon: 'heart-pulse',
    color: 'red',
  },
  {
    key: 'health.pharmacy',
    kind: 'expense',
    parentKey: 'health',
    icon: 'heart-pulse',
    color: 'red',
  },
  { key: 'health.doctor', kind: 'expense', parentKey: 'health', icon: 'heart-pulse', color: 'red' },
  { key: 'entertainment', kind: 'expense', parentKey: null, icon: 'clapperboard', color: 'violet' },
  {
    key: 'entertainment.outings',
    kind: 'expense',
    parentKey: 'entertainment',
    icon: 'clapperboard',
    color: 'violet',
  },
  {
    key: 'entertainment.streaming',
    kind: 'expense',
    parentKey: 'entertainment',
    icon: 'clapperboard',
    color: 'violet',
  },
  {
    key: 'entertainment.hobbies',
    kind: 'expense',
    parentKey: 'entertainment',
    icon: 'clapperboard',
    color: 'violet',
  },
  { key: 'shopping', kind: 'expense', parentKey: null, icon: 'shopping-bag', color: 'pink' },
  {
    key: 'shopping.clothing',
    kind: 'expense',
    parentKey: 'shopping',
    icon: 'shopping-bag',
    color: 'pink',
  },
  {
    key: 'shopping.electronics',
    kind: 'expense',
    parentKey: 'shopping',
    icon: 'shopping-bag',
    color: 'pink',
  },
  {
    key: 'shopping.gifts',
    kind: 'expense',
    parentKey: 'shopping',
    icon: 'shopping-bag',
    color: 'pink',
  },
  { key: 'education', kind: 'expense', parentKey: null, icon: 'graduation-cap', color: 'cyan' },
  { key: 'taxes', kind: 'expense', parentKey: null, icon: 'receipt', color: 'slate' },
  { key: 'other-expenses', kind: 'expense', parentKey: null, icon: 'ellipsis', color: 'slate' },
  { key: 'salary', kind: 'income', parentKey: null, icon: 'banknote', color: 'green' },
  { key: 'freelance', kind: 'income', parentKey: null, icon: 'laptop', color: 'teal' },
  {
    key: 'investment-returns',
    kind: 'income',
    parentKey: null,
    icon: 'trending-up',
    color: 'lime',
  },
  { key: 'gifts-received', kind: 'income', parentKey: null, icon: 'gift', color: 'pink' },
  { key: 'other-income', kind: 'income', parentKey: null, icon: 'ellipsis', color: 'slate' },
];
