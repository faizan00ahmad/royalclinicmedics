import { schema } from "@rmc/db";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "./db-types";
import { loadSettingsMap } from "./settings";

/** Read-side content for the public website. Everything shown on the site comes from here, never from components (CLAUDE.md). */

export type ServiceRow = typeof schema.services.$inferSelect;
export type DoctorRow = typeof schema.doctors.$inferSelect;

export interface ClinicInfo {
  name: string;
  phone: string;
  email: string;
  whatsapp: string;
  address: string;
  eircode: string;
  mapQuery: string;
  googleReviewUrl: string;
  openingHoursText: string;
  cancellationWindowHours: number;
  features: { googleReviews: boolean; onlineConsultations: boolean };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function getClinicInfo(db: Database): Promise<ClinicInfo> {
  const s = await loadSettingsMap(db);
  return {
    name: str(s["clinic.name"]),
    phone: str(s["clinic.phone"]),
    email: str(s["clinic.email"]),
    whatsapp: str(s["clinic.whatsapp"]),
    address: str(s["clinic.address"]),
    eircode: str(s["clinic.eircode"]),
    mapQuery: str(s["clinic.mapQuery"]),
    googleReviewUrl: str(s["clinic.googleReviewUrl"]),
    openingHoursText: str(s["clinic.openingHoursText"]),
    cancellationWindowHours: typeof s["booking.cancellationWindowHours"] === "number" ? (s["booking.cancellationWindowHours"] as number) : 24,
    features: {
      googleReviews: s["features.googleReviews"] === true,
      onlineConsultations: s["features.onlineConsultations"] === true,
    },
  };
}

/** A value still marked [TBD] must not be shown to patients as if it were real (see docs/TBD.md). */
export const isTbd = (v: string) => !v || v.includes("[TBD]");

export async function listServices(db: Database, opts: { featuredOnly?: boolean } = {}): Promise<ServiceRow[]> {
  return db.select().from(schema.services)
    .where(and(eq(schema.services.active, true), opts.featuredOnly ? eq(schema.services.featured, true) : undefined))
    .orderBy(asc(schema.services.sortOrder), asc(schema.services.name));
}

export function groupBy<T>(items: T[], key: (t: T) => string): { key: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const i of items) map.set(key(i), [...(map.get(key(i)) ?? []), i]);
  return [...map].map(([k, v]) => ({ key: k, items: v }));
}

export async function getServiceBySlug(db: Database, slug: string) {
  const [service] = await db.select().from(schema.services)
    .where(and(eq(schema.services.slug, slug), eq(schema.services.active, true)));
  if (!service) return null;
  const faqs = await db.select().from(schema.serviceFaqs)
    .where(eq(schema.serviceFaqs.serviceId, service.id)).orderBy(asc(schema.serviceFaqs.sortOrder));
  const doctors = await db.select({ doctor: schema.doctors }).from(schema.serviceDoctors)
    .innerJoin(schema.doctors, eq(schema.doctors.id, schema.serviceDoctors.doctorId))
    .where(and(eq(schema.serviceDoctors.serviceId, service.id), eq(schema.doctors.isActive, true)));
  return { service, faqs, doctors: doctors.map((d) => d.doctor) };
}

export async function listDoctors(db: Database): Promise<DoctorRow[]> {
  return db.select().from(schema.doctors).where(eq(schema.doctors.isActive, true)).orderBy(asc(schema.doctors.sortOrder));
}

export async function listFaqs(db: Database) {
  const rows = await db.select().from(schema.faqs).where(eq(schema.faqs.active, true))
    .orderBy(asc(schema.faqs.category), asc(schema.faqs.sortOrder));
  return groupBy(rows, (r) => r.category);
}

/** Latest version of a page, for example privacy or terms (WEB-09). */
export async function getPage(db: Database, key: string) {
  const [page] = await db.select().from(schema.pages).where(eq(schema.pages.key, key)).orderBy(desc(schema.pages.version)).limit(1);
  return page ?? null;
}

/** WEB-17. Empty unless the feature flag is on, so reviews stay hidden until the clinic confirms they may show them. */
export async function listReviews(db: Database, clinic: ClinicInfo) {
  if (!clinic.features.googleReviews) return [];
  return db.select().from(schema.reviews).where(eq(schema.reviews.active, true)).orderBy(asc(schema.reviews.sortOrder));
}

export async function getAnnouncement(db: Database, now: Date = new Date()) {
  const rows = await db.select().from(schema.announcements).where(eq(schema.announcements.active, true));
  return rows.find((a) => (!a.startsAt || a.startsAt <= now) && (!a.endsAt || a.endsAt >= now)) ?? null;
}
