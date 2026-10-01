const SEPARATORS = {
  en: { group: ',', decimal: '.' },
  es: { group: '.', decimal: ',' },
} as const;

/**
 * Formats an amount in minor units (2 decimals) with integer arithmetic only, so it stays exact for
 * any bigint. `en` follows en-US and `es` follows es-AR.
 */
export function formatMinorUnits(amount: bigint, language: 'es' | 'en'): string {
  const { group, decimal } = SEPARATORS[language];
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+$)/g, group);
  const cents = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}${decimal}${cents}`;
}
