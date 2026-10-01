/**
 * The zones for the time zone select: the runtime's IANA list plus the saved value, which can be
 * one the runtime does not list (a zone stored as the device reported it at registration), so the
 * select always shows what is saved.
 */
export function timeZoneOptions(saved: string): string[] {
  // Older engines lack `supportedValuesOf`; the saved value alone keeps the form usable.
  const listed =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [...new Set([...listed, saved])].sort();
}
