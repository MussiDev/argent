import { CATEGORY_ICONS, type CategoryIcon } from '@pesly/shared';
import {
  Baby,
  Banknote,
  BookOpen,
  Briefcase,
  Car,
  CircleQuestionMark,
  Clapperboard,
  Coffee,
  Dumbbell,
  Ellipsis,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Laptop,
  PawPrint,
  PiggyBank,
  Plane,
  Receipt,
  Shirt,
  ShoppingBag,
  TrendingUp,
  Utensils,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/** The shared icon keys mapped to Lucide components: nothing else reaches the page. */
export const CATEGORY_ICON_COMPONENTS: Record<CategoryIcon, LucideIcon> = {
  utensils: Utensils,
  car: Car,
  home: House,
  'heart-pulse': HeartPulse,
  clapperboard: Clapperboard,
  'shopping-bag': ShoppingBag,
  'graduation-cap': GraduationCap,
  receipt: Receipt,
  ellipsis: Ellipsis,
  banknote: Banknote,
  laptop: Laptop,
  'trending-up': TrendingUp,
  gift: Gift,
  wallet: Wallet,
  'piggy-bank': PiggyBank,
  plane: Plane,
  shirt: Shirt,
  'book-open': BookOpen,
  briefcase: Briefcase,
  coffee: Coffee,
  dumbbell: Dumbbell,
  'paw-print': PawPrint,
  baby: Baby,
  wrench: Wrench,
};

export const FALLBACK_CATEGORY_ICON: LucideIcon = CircleQuestionMark;

export function isCategoryIcon(key: string): key is CategoryIcon {
  return (CATEGORY_ICONS as readonly string[]).includes(key);
}
