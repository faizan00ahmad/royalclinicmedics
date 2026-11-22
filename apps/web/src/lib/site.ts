import { getAnnouncement, getClinicInfo, isTbd, type ClinicInfo } from "@rmc/core";
import { db } from "./server";

/** Strip the [TBD] markers so placeholders never show up as text for patients. */
export const clean = (v: string) => v.replace(/\s*\[TBD\]\s*/g, " ").trim();
export const telHref = (phone: string) => `tel:${phone.replace(/[^+\d]/g, "")}`;
export const hasPhone = (c: ClinicInfo) => !isTbd(c.phone);

export async function loadChrome() {
  const [clinic, announcement] = await Promise.all([getClinicInfo(db()), getAnnouncement(db())]);
  return { clinic, announcement };
}
