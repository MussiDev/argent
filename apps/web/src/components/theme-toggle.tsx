'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { THEMES, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useTheme } from './theme-provider';

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const satisfies Record<Theme, unknown>;

/** Segmented control for light, dark and system. Native radios give keyboard support for free. */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations('theme');
  const { theme, setTheme } = useTheme();

  return (
    <fieldset className={cn('m-0 min-w-0 border-0 p-0', className)}>
      <legend className="sr-only">{t('label')}</legend>
      <div className="inline-flex gap-1 rounded-lg border bg-surface p-1">
        {THEMES.map((value) => {
          const Icon = ICONS[value];
          return (
            <label
              key={value}
              className="relative inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-md px-3 text-small font-medium text-muted-foreground transition-colors has-checked:bg-card has-checked:text-foreground has-checked:shadow-xs has-focus-visible:ring-2 has-focus-visible:ring-ring"
            >
              <input
                type="radio"
                name="theme"
                value={value}
                checked={theme === value}
                onChange={() => {
                  setTheme(value);
                }}
                className="peer absolute inset-0 cursor-pointer appearance-none rounded-md outline-none"
                aria-label={t(value)}
              />
              <Icon aria-hidden className="size-4" />
              <span aria-hidden>{t(value)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
