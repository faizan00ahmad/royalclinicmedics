import { schema } from "@rmc/db";
import type { Database } from "./db-types";
import type { SlotSettings } from "./slots";

const TBD = "[TBD]";

/** Defaults written by the seed. Every [TBD] is listed in docs/TBD.md and edited in admin. */
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  "clinic.name": "Royal Medics Clinic",
  "clinic.phone": TBD,
  "clinic.email": TBD,
  "clinic.whatsapp": "",
  "clinic.address": TBD,
  "clinic.eircode": TBD,
  "clinic.mapQuery": TBD,
  "clinic.googleReviewUrl": "",
  "clinic.openingHoursText": "Mon to Fri 09:00 to 17:30 [TBD]",
  "booking.slotIntervalMinutes": 15,
  "booking.minNoticeMinutes": 60,
  "booking.bookingWindowDays": 30,
  "booking.cancellationWindowHours": 24,
  "booking.maxReschedules": 2,
  "booking.holdMinutes": 10,
  "booking.gmsPolicy": "ASK_TO_CALL", // CHARGE_NORMALLY | FREE_FOR_ELIGIBLE | ASK_TO_CALL
  "features.onlineConsultations": false, // EXT-01
  "features.googleReviews": false, // off until Medical Council advertising guidance is checked
  "notifications.reminderHours": [24, 2],
};

export interface BookingSettings extends SlotSettings {
  cancellationWindowHours: number;
  maxReschedules: number;
  holdMinutes: number;
  onlineConsultations: boolean;
}

export async function loadSettingsMap(db: Database): Promise<Record<string, unknown>> {
  const rows = await db.select().from(schema.settings);
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export async function loadBookingSettings(db: Database): Promise<BookingSettings> {
  const s = await loadSettingsMap(db);
  return {
    slotIntervalMinutes: num(s["booking.slotIntervalMinutes"], 15),
    minNoticeMinutes: num(s["booking.minNoticeMinutes"], 60),
    bookingWindowDays: num(s["booking.bookingWindowDays"], 30),
    cancellationWindowHours: num(s["booking.cancellationWindowHours"], 24),
    maxReschedules: num(s["booking.maxReschedules"], 2),
    holdMinutes: num(s["booking.holdMinutes"], 10),
    onlineConsultations: s["features.onlineConsultations"] === true,
  };
}
