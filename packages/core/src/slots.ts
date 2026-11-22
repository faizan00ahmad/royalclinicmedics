import { formatInTimeZone } from "date-fns-tz";
import { CLINIC_TZ, dublinToUtc } from "./time";

/**
 * Slot engine (BK-10 .. BK-15). Pure function: no database, no clock.
 * Callers load the rows, pass them in, and get back the free start times.
 * All wall-clock times are Europe/Dublin; all returned instants are UTC Dates.
 */

export interface WorkingRule {
  weekday: number; // 0 = Sunday .. 6 = Saturday
  startTime: string; // "HH:mm" or "HH:mm:ss", Dublin wall clock
  endTime: string;
  validFrom?: string | null; // YYYY-MM-DD
  validTo?: string | null;
}

export interface DateOverride {
  date: string; // YYYY-MM-DD
  isClosed: boolean;
  startTime?: string | null;
  endTime?: string | null;
}

export interface DoctorAvailability {
  id: string;
  rules: WorkingRule[];
  overrides: DateOverride[];
}

export interface Interval {
  doctorId: string;
  startAt: Date;
  endAt: Date;
}

export interface SlotSettings {
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  bookingWindowDays: number;
}

export interface SlotServiceInput {
  durationMin: number;
  bufferMin: number;
  minNoticeOverrideMin?: number | null;
}

export interface ComputeSlotsInput {
  now: Date;
  fromDate: string; // YYYY-MM-DD, Dublin
  toDate: string; // inclusive
  service: SlotServiceInput;
  settings: SlotSettings;
  doctors: DoctorAvailability[];
  holidays: string[]; // YYYY-MM-DD
  /** One-off or repeating blocked time, already expanded to concrete intervals. */
  blocks: Interval[];
  /**
   * Existing appointments and active holds. endAt must already include the buffer,
   * exactly as stored in core.slot_locks.
   */
  busy: Interval[];
}

export interface Slot {
  doctorId: string;
  startAt: Date;
  /** End of the appointment itself, without buffer. */
  endAt: Date;
  /** End including the buffer. This is what gets written to slot_locks. */
  lockEndAt: Date;
}

const MIN = 60_000;

const hhmm = (t: string) => t.slice(0, 5);

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function dublinDate(instant: Date): string {
  return formatInTimeZone(instant, CLINIC_TZ, "yyyy-MM-dd");
}

const overlaps = (aStart: number, aEnd: number, b: Interval) =>
  aStart < b.endAt.getTime() && b.startAt.getTime() < aEnd;

interface Range { start: string; end: string }

/**
 * Working ranges for one doctor on one date.
 * - A clinic holiday removes the regular rules for that date.
 * - A closed override removes everything for that doctor on that date.
 * - A non-closed override ADDS an extra range (it still opens on a holiday).
 */
function rangesFor(doctor: DoctorAvailability, date: string, isHoliday: boolean): Range[] {
  const overrides = doctor.overrides.filter((o) => o.date === date);
  if (overrides.some((o) => o.isClosed)) return [];

  const ranges: Range[] = [];
  if (!isHoliday) {
    const weekday = weekdayOf(date);
    for (const r of doctor.rules) {
      if (r.weekday !== weekday) continue;
      if (r.validFrom && date < r.validFrom) continue;
      if (r.validTo && date > r.validTo) continue;
      ranges.push({ start: hhmm(r.startTime), end: hhmm(r.endTime) });
    }
  }
  for (const o of overrides) {
    if (o.startTime && o.endTime) ranges.push({ start: hhmm(o.startTime), end: hhmm(o.endTime) });
  }
  return ranges;
}

export function computeSlots(input: ComputeSlotsInput): Slot[] {
  const { now, service, settings } = input;
  if (service.durationMin <= 0) throw new RangeError("durationMin must be positive");
  if (settings.slotIntervalMinutes <= 0) throw new RangeError("slotIntervalMinutes must be positive");

  const holidays = new Set(input.holidays);
  const minNotice = service.minNoticeOverrideMin ?? settings.minNoticeMinutes;
  const earliest = now.getTime() + minNotice * MIN;
  const lastDate = addDays(dublinDate(now), settings.bookingWindowDays);
  const lastAllowed = input.toDate < lastDate ? input.toDate : lastDate;

  const stepMs = settings.slotIntervalMinutes * MIN;
  const durationMs = service.durationMin * MIN;
  const lockMs = (service.durationMin + service.bufferMin) * MIN;

  const slots: Slot[] = [];

  for (let date = input.fromDate; date <= lastAllowed; date = addDays(date, 1)) {
    const isHoliday = holidays.has(date);
    for (const doctor of input.doctors) {
      const blocked = [
        ...input.blocks.filter((b) => b.doctorId === doctor.id),
        ...input.busy.filter((b) => b.doctorId === doctor.id),
      ];
      const seen = new Set<number>();
      for (const range of rangesFor(doctor, date, isHoliday)) {
        // Real elapsed time between the two UTC instants, so DST changes cannot skew slots.
        const rangeStart = dublinToUtc(`${date} ${range.start}`).getTime();
        const rangeEnd = dublinToUtc(`${date} ${range.end}`).getTime();
        for (let t = rangeStart; t + durationMs <= rangeEnd; t += stepMs) {
          if (t < earliest || seen.has(t)) continue;
          const lockEnd = t + lockMs;
          if (blocked.some((b) => overlaps(t, lockEnd, b))) continue;
          seen.add(t);
          slots.push({
            doctorId: doctor.id,
            startAt: new Date(t),
            endAt: new Date(t + durationMs),
            lockEndAt: new Date(lockEnd),
          });
        }
      }
    }
  }

  return slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.doctorId.localeCompare(b.doctorId));
}

/** Dublin dates that have at least one free slot (BK-03 calendar). */
export function availableDays(slots: Slot[]): string[] {
  return [...new Set(slots.map((s) => dublinDate(s.startAt)))].sort();
}

export type DayPart = "MORNING" | "AFTERNOON" | "EVENING";

export function dayPart(startAt: Date): DayPart {
  const hour = Number(formatInTimeZone(startAt, CLINIC_TZ, "H"));
  return hour < 12 ? "MORNING" : hour < 17 ? "AFTERNOON" : "EVENING";
}

/** "First available": earliest slot, optionally for one doctor. */
export function nextAvailable(slots: Slot[], doctorId?: string): Slot | undefined {
  return slots.find((s) => !doctorId || s.doctorId === doctorId);
}
