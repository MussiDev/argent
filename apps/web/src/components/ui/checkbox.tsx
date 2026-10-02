import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Native `<input type="checkbox">` styled with theme tokens: keyboard and screen-reader support
 * come from the platform, with no extra dependency. Label it with `<Label htmlFor>` or `aria-label`.
 */
export function Checkbox({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      data-slot="checkbox"
      className={cn(
        'size-4 shrink-0 cursor-pointer rounded-sm border border-input bg-transparent accent-primary shadow-xs transition-[color,box-shadow] outline-none dark:bg-input/30',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
      type="checkbox"
    />
  );
}
