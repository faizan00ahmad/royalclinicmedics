import { fromZonedTime, toZonedTime, formatInTimeZone } from "date-fns-tz";

export const CLINIC_TZ = "Europe/Dublin";

/** Convert a Dublin wall-clock time (e.g. "2026-03-29 10:00") to a UTC Date. DST-safe. */
export function dublinToUtc(wallClock: string): Date {
  return fromZonedTime(wallClock, CLINIC_TZ);
}

export function utcToDublin(date: Date): Date {
  return toZonedTime(date, CLINIC_TZ);
}

/** e.g. "Mon 24 Nov 2026, 10:30" (NFR-08) */
export function formatDublin(date: Date): string {
  return formatInTimeZone(date, CLINIC_TZ, "EEE d MMM yyyy, HH:mm");
}
