import { DISPLAY_NAME_MAX_CODE_POINTS } from '@pesly/shared';

/** The Google claim is untrusted: any string is reduced to a valid display name or null. */
export function displayNameFromGoogleClaim(name: string | null): string | null {
  if (name === null) return null;
  const cleaned = name.replaceAll('\u0000', '').trim();
  if (cleaned === '') return null;
  const codePoints = Array.from(cleaned);
  if (codePoints.length <= DISPLAY_NAME_MAX_CODE_POINTS) return cleaned;
  return codePoints.slice(0, DISPLAY_NAME_MAX_CODE_POINTS).join('').trimEnd();
}
