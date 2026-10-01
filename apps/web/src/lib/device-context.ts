import { LANGUAGE_INPUT_MAX_LENGTH, TIME_ZONE_INPUT_MAX_LENGTH } from '@pesly/shared';

/** What the device reports at registration; the API resolves defaults for missing values. */
export interface DeviceContext {
  timeZone: string | undefined;
  language: string | undefined;
}

function bounded(value: unknown, maxLength: number): string | undefined {
  // An oversized value would fail the whole registration; the API's default is better than that.
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : undefined;
}

function reportedTimeZone(): unknown {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Some runtimes throw when the host time zone is unknown to ICU: report none (AC-20).
    return undefined;
  }
}

/** The device's IANA time zone (FR-10) and language (FR-11), as the browser reports them. */
export function readDeviceContext(): DeviceContext {
  const language: unknown = typeof navigator === 'undefined' ? undefined : navigator.language;
  return {
    timeZone: bounded(reportedTimeZone(), TIME_ZONE_INPUT_MAX_LENGTH),
    language: bounded(language, LANGUAGE_INPUT_MAX_LENGTH),
  };
}
