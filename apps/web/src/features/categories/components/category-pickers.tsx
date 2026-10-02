'use client';

import { CATEGORY_COLORS, CATEGORY_ICONS } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import type { CategoryFieldControlProps } from './category-field';
import { CATEGORY_SWATCH_CLASSES, CategoryVisual } from './category-visual';

const OPTION_RING =
  'peer-checked:ring-2 peer-checked:ring-ring peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-disabled:opacity-50';

/** The 24 icons as native radios; the radio is visually hidden and its label is the icon. */
export function IconPicker({
  control,
  defaultValue,
}: {
  control: CategoryFieldControlProps;
  defaultValue?: string;
}) {
  const t = useTranslations('categories.icons');
  return (
    <div
      role="radiogroup"
      tabIndex={-1}
      aria-labelledby={control['aria-labelledby']}
      aria-invalid={control['aria-invalid']}
      aria-describedby={control['aria-describedby']}
      className="flex flex-wrap gap-2 outline-none"
    >
      {CATEGORY_ICONS.map((icon) => (
        <label key={icon} className="relative cursor-pointer">
          <input
            type="radio"
            name="icon"
            value={icon}
            defaultChecked={icon === defaultValue}
            className="peer sr-only"
          />
          <CategoryVisual
            icon={icon}
            color="slate"
            className={`rounded-md border bg-card text-card-foreground ${OPTION_RING}`}
          />
          <span className="sr-only">{t(icon)}</span>
        </label>
      ))}
    </div>
  );
}

/** The 12 colors as native radios; the label is a swatch of the token plus the color name. */
export function ColorPicker({
  control,
  defaultValue,
}: {
  control: CategoryFieldControlProps;
  defaultValue?: string;
}) {
  const t = useTranslations('categories.colors');
  return (
    <div
      role="radiogroup"
      tabIndex={-1}
      aria-labelledby={control['aria-labelledby']}
      aria-invalid={control['aria-invalid']}
      aria-describedby={control['aria-describedby']}
      className="flex flex-wrap gap-2 outline-none"
    >
      {CATEGORY_COLORS.map((color) => (
        <label key={color} className="relative cursor-pointer">
          <input
            type="radio"
            name="color"
            value={color}
            defaultChecked={color === defaultValue}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className={`block size-7 rounded-full ${CATEGORY_SWATCH_CLASSES[color]} ${OPTION_RING} peer-checked:ring-offset-2 peer-checked:ring-offset-background`}
          />
          <span className="sr-only">{t(color)}</span>
        </label>
      ))}
    </div>
  );
}
