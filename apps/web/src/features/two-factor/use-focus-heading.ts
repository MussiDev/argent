'use client';

import { useCallback } from 'react';

/**
 * A ref for a view's heading (with `tabIndex={-1}`) that focuses it when it mounts, if `enabled`.
 * When the settings screen swaps one view for another, the focus would otherwise fall back to the
 * page body and screen readers would not announce the new view.
 */
export function useFocusHeading(enabled: boolean) {
  return useCallback(
    (heading: HTMLElement | null) => {
      if (enabled) heading?.focus();
    },
    [enabled],
  );
}
