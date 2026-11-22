import { schema } from "@rmc/db";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../audit";
import { BookingError } from "../booking/errors";
import type { Database } from "../db-types";
import { DEFAULT_SETTINGS } from "../settings";
import type { Actor } from "./appointments";

const audited = (a: Actor, action: string, entityType: string, entityId: string | undefined, changes?: Record<string, unknown>) =>
  ({ actorUserId: a.id, actorRole: a.role, action, entityType, entityId, ip: a.ip, changes });

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

// ------------------------------------------------------------- services (AD-07)

export const serviceInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().max(80).optional(),
  category: z.string().trim().min(1).max(60).default("General"),
  shortDescription: z.string().trim().max(300).optional(),
  description: z.string().trim().max(5000).optional(),
  priceCents: z.number().int().min(0).max(1_000_000),
  durationMin: z.number().int().min(5).max(480),
  bufferMin: z.number().int().min(0).max(120).default(0),
  payAtClinicAllowed: z.boolean().default(true),
  gmsEligible: z.boolean().default(false),
  minNoticeOverrideMin: z.number().int().min(0).max(10_080).nullable().optional(),
  featured: z.boolean().default(false),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  seoTitle: z.string().trim().max(70).optional(),
  seoDescription: z.string().trim().max(160).optional(),
  doctorIds: z.array(z.string().uuid()).default([]),
});
export type ServiceInput = z.input<typeof serviceInput>;

/** Changes appear on the website immediately because the site reads the same table. */
export async function saveService(db: Database, raw: ServiceInput, actor: Actor) {
  const i = serviceInput.parse(raw);
  const slug = slugify(i.slug || i.name);
  if (!slug) throw new BookingError("POLICY", "Please give the service a name.");
  return db.transaction(async (tx) => {
    const clash = await tx.select({ id: schema.services.id }).from(schema.services)
      .where(and(eq(schema.services.slug, slug), i.id ? ne(schema.services.id, i.id) : undefined));
    if (clash.length) throw new BookingError("POLICY", "Another service already uses that web address. Change the name or address.");

    const { doctorIds, id, ...fields } = i;
    const values = {
      ...fields, slug, shortDescription: fields.shortDescription ?? null, description: fields.description ?? null,
      seoTitle: fields.seoTitle ?? null, seoDescription: fields.seoDescription ?? null, minNoticeOverrideMin: fields.minNoticeOverrideMin ?? null,
      updatedAt: new Date(),
    };
    let serviceId = id;
    let before: { priceCents: number } | undefined;
    if (id) {
      [before] = await tx.select({ priceCents: schema.services.priceCents }).from(schema.services).where(eq(schema.services.id, id));
      await tx.update(schema.services).set(values).where(eq(schema.services.id, id));
    } else {
      const [row] = await tx.insert(schema.services).values(values).returning({ id: schema.services.id });
      serviceId = row!.id;
    }
    await tx.delete(schema.serviceDoctors).where(eq(schema.serviceDoctors.serviceId, serviceId!));
    if (doctorIds.length) await tx.insert(schema.serviceDoctors).values(doctorIds.map((d) => ({ serviceId: serviceId!, doctorId: d })));
    await audit(tx, audited(actor, id ? "service.update" : "service.create", "service", serviceId, {
      name: i.name, ...(before && before.priceCents !== i.priceCents ? { priceFrom: before.priceCents, priceTo: i.priceCents } : {}),
    }));
    return serviceId!;
  });
}

export async function listAllServices(db: Database) {
  const services = await db.select().from(schema.services).orderBy(asc(schema.services.sortOrder), asc(schema.services.name));
  const links = await db.select().from(schema.serviceDoctors);
  return services.map((s) => ({ ...s, doctorIds: links.filter((l) => l.serviceId === s.id).map((l) => l.doctorId) }));
}

// -------------------------------------------------------------- doctors (AD-08)

export const doctorInput = z.object({
  id: z.string().uuid().optional(),
  displayName: z.string().trim().min(2).max(120),
  title: z.string().trim().max(80).optional(),
  bio: z.string().trim().max(3000).optional(),
  qualifications: z.string().trim().max(500).optional(),
  imcNumber: z.string().trim().max(30).optional(),
  languages: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
  userId: z.string().uuid().nullable().optional(),
});

export async function saveDoctor(db: Database, raw: z.input<typeof doctorInput>, actor: Actor) {
  const { id, ...i } = doctorInput.parse(raw);
  const values = { ...i, title: i.title ?? null, bio: i.bio ?? null, qualifications: i.qualifications ?? null, imcNumber: i.imcNumber ?? null, userId: i.userId ?? null };
  return db.transaction(async (tx) => {
    let doctorId = id;
    if (id) await tx.update(schema.doctors).set({ ...values, updatedAt: new Date() }).where(eq(schema.doctors.id, id));
    else doctorId = (await tx.insert(schema.doctors).values(values).returning({ id: schema.doctors.id }))[0]!.id;
    await audit(tx, audited(actor, id ? "doctor.update" : "doctor.create", "doctor", doctorId, { name: i.displayName, active: i.isActive }));
    return doctorId!;
  });
}

// ------------------------------------------------ schedules, holidays, blocks (AD-09)

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
export const weeklyRule = z.object({ weekday: z.number().int().min(0).max(6), startTime: hhmm, endTime: hhmm })
  .refine((r) => r.endTime > r.startTime, { message: "End must be after start" });

/** Replaces a doctor's whole weekly pattern. Overlapping ranges on the same day are rejected. */
export async function saveWeeklyHours(db: Database, doctorId: string, rules: z.input<typeof weeklyRule>[], actor: Actor) {
  const parsed = rules.map((r) => weeklyRule.parse(r));
  for (let d = 0; d < 7; d++) {
    const day = parsed.filter((r) => r.weekday === d).sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let k = 1; k < day.length; k++) {
      if (day[k]!.startTime < day[k - 1]!.endTime) throw new BookingError("POLICY", "Two time ranges on the same day overlap.");
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(schema.availabilityRules).where(eq(schema.availabilityRules.doctorId, doctorId));
    if (parsed.length) await tx.insert(schema.availabilityRules).values(parsed.map((r) => ({ doctorId, ...r })));
    await audit(tx, audited(actor, "schedule.weekly", "doctor", doctorId, { ranges: parsed.length }));
  });
}

export async function addOverride(db: Database, input: { doctorId: string; date: string; isClosed: boolean; startTime?: string; endTime?: string; note?: string }, actor: Actor) {
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(input.date);
  if (!input.isClosed) {
    hhmm.parse(input.startTime); hhmm.parse(input.endTime);
    if ((input.endTime ?? "") <= (input.startTime ?? "")) throw new BookingError("POLICY", "End must be after start.");
  }
  const [row] = await db.insert(schema.availabilityOverrides).values({
    doctorId: input.doctorId, date: input.date, isClosed: input.isClosed,
    startTime: input.isClosed ? null : input.startTime!, endTime: input.isClosed ? null : input.endTime!, note: input.note?.slice(0, 200) ?? null,
  }).returning({ id: schema.availabilityOverrides.id });
  await audit(db, audited(actor, "schedule.override_add", "doctor", input.doctorId, { date: input.date, closed: input.isClosed }));
  return row!.id;
}

export async function removeOverride(db: Database, id: string, actor: Actor) {
  await db.delete(schema.availabilityOverrides).where(eq(schema.availabilityOverrides.id, id));
  await audit(db, audited(actor, "schedule.override_remove", "override", id));
}

export async function addHoliday(db: Database, input: { date: string; name: string }, actor: Actor) {
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(input.date);
  await db.insert(schema.clinicHolidays).values({ date: input.date, name: input.name.trim().slice(0, 100) || "Closed" })
    .onConflictDoUpdate({ target: schema.clinicHolidays.date, set: { name: input.name.trim().slice(0, 100) || "Closed" } });
  await audit(db, audited(actor, "holiday.add", "holiday", input.date));
}

export async function removeHoliday(db: Database, id: string, actor: Actor) {
  await db.delete(schema.clinicHolidays).where(eq(schema.clinicHolidays.id, id));
  await audit(db, audited(actor, "holiday.remove", "holiday", id));
}

export async function addTimeBlock(db: Database, input: { doctorId: string; startAt: Date; endAt: Date; reason?: string }, actor: Actor) {
  if (input.endAt <= input.startAt) throw new BookingError("POLICY", "End must be after start.");
  const [row] = await db.insert(schema.timeBlocks).values({ doctorId: input.doctorId, startAt: input.startAt, endAt: input.endAt, reason: input.reason?.slice(0, 200) ?? null }).returning({ id: schema.timeBlocks.id });
  await audit(db, audited(actor, "schedule.block_add", "doctor", input.doctorId));
  return row!.id;
}

export async function removeTimeBlock(db: Database, id: string, actor: Actor) {
  await db.delete(schema.timeBlocks).where(eq(schema.timeBlocks.id, id));
  await audit(db, audited(actor, "schedule.block_remove", "time_block", id));
}

export async function getSchedule(db: Database, doctorId: string) {
  const [rules, overrides, blocks] = await Promise.all([
    db.select().from(schema.availabilityRules).where(eq(schema.availabilityRules.doctorId, doctorId)).orderBy(asc(schema.availabilityRules.weekday), asc(schema.availabilityRules.startTime)),
    db.select().from(schema.availabilityOverrides).where(eq(schema.availabilityOverrides.doctorId, doctorId)).orderBy(desc(schema.availabilityOverrides.date)),
    db.select().from(schema.timeBlocks).where(eq(schema.timeBlocks.doctorId, doctorId)).orderBy(desc(schema.timeBlocks.startAt)),
  ]);
  return { rules, overrides, blocks };
}

// ------------------------------------------------------------- settings (AD-12)

type Kind = "string" | "number" | "boolean";
/** Only these keys can be changed from the screen, each with a type and limits. */
export const EDITABLE_SETTINGS: Record<string, { kind: Kind; label: string; min?: number; max?: number; group: string; help?: string }> = {
  "clinic.name": { kind: "string", label: "Clinic name", group: "Clinic" },
  "clinic.phone": { kind: "string", label: "Phone", group: "Clinic" },
  "clinic.email": { kind: "string", label: "Email", group: "Clinic" },
  "clinic.whatsapp": { kind: "string", label: "WhatsApp number (optional)", group: "Clinic" },
  "clinic.address": { kind: "string", label: "Address", group: "Clinic" },
  "clinic.eircode": { kind: "string", label: "Eircode", group: "Clinic" },
  "clinic.mapQuery": { kind: "string", label: "Map search (address as Google Maps would find it)", group: "Clinic" },
  "clinic.googleReviewUrl": { kind: "string", label: "Google reviews link", group: "Clinic" },
  "clinic.openingHoursText": { kind: "string", label: "Opening hours (shown on the website)", group: "Clinic" },
  "booking.slotIntervalMinutes": { kind: "number", label: "Appointment start times every (minutes)", min: 5, max: 60, group: "Booking rules" },
  "booking.minNoticeMinutes": { kind: "number", label: "Minimum notice (minutes)", min: 0, max: 10_080, group: "Booking rules" },
  "booking.bookingWindowDays": { kind: "number", label: "How far ahead patients can book (days)", min: 1, max: 365, group: "Booking rules" },
  "booking.cancellationWindowHours": { kind: "number", label: "Free change or cancel until (hours before)", min: 0, max: 720, group: "Booking rules" },
  "booking.maxReschedules": { kind: "number", label: "Changes allowed per booking", min: 0, max: 10, group: "Booking rules" },
  "booking.holdMinutes": { kind: "number", label: "Hold a chosen time for (minutes)", min: 3, max: 30, group: "Booking rules" },
  "features.googleReviews": { kind: "boolean", label: "Show Google reviews on the website", group: "Features", help: "Check Medical Council advertising guidance before switching this on." },
};

export async function saveSettings(db: Database, values: Record<string, string | number | boolean>, actor: Actor) {
  const changed: string[] = [];
  await db.transaction(async (tx) => {
    for (const [key, raw] of Object.entries(values)) {
      const def = EDITABLE_SETTINGS[key];
      if (!def) throw new BookingError("POLICY", `Unknown setting: ${key}`);
      let value: string | number | boolean = raw;
      if (def.kind === "number") {
        value = Number(raw);
        if (!Number.isFinite(value) || value < (def.min ?? -Infinity) || value > (def.max ?? Infinity)) throw new BookingError("POLICY", `${def.label} must be between ${def.min} and ${def.max}.`);
      } else if (def.kind === "boolean") value = raw === true || raw === "true" || raw === "on";
      else value = String(raw).trim().slice(0, 300);
      await tx.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
      changed.push(key);
    }
    await audit(tx, audited(actor, "settings.update", "settings", undefined, { keys: changed }));
  });
}

export const DEFAULT_SETTING_VALUES = DEFAULT_SETTINGS;

// ----------------------------------------------------------- enquiries (AD-11)

export async function listEnquiries(db: Database, status?: string) {
  return db.select().from(schema.enquiries).where(status ? eq(schema.enquiries.status, status) : undefined).orderBy(desc(schema.enquiries.createdAt)).limit(200);
}

export async function updateEnquiry(db: Database, input: { id: string; status: "NEW" | "REPLIED" | "CLOSED"; notes?: string }, actor: Actor) {
  await db.update(schema.enquiries).set({
    status: input.status, notes: input.notes?.slice(0, 1000) ?? null, repliedAt: input.status === "REPLIED" ? new Date() : null,
  }).where(eq(schema.enquiries.id, input.id));
  await audit(db, audited(actor, "enquiry.update", "enquiry", input.id, { status: input.status }));
}

// --------------------------------------------------------- content (AD-10)

export async function saveFaq(db: Database, input: { id?: string; category: string; question: string; answer: string; sortOrder?: number; active?: boolean }, actor: Actor) {
  const v = z.object({
    category: z.string().trim().min(1).max(60), question: z.string().trim().min(3).max(300), answer: z.string().trim().min(1).max(3000),
    sortOrder: z.number().int().default(0), active: z.boolean().default(true),
  }).parse(input);
  let id = input.id;
  if (id) await db.update(schema.faqs).set(v).where(eq(schema.faqs.id, id));
  else id = (await db.insert(schema.faqs).values(v).returning({ id: schema.faqs.id }))[0]!.id;
  await audit(db, audited(actor, input.id ? "faq.update" : "faq.create", "faq", id));
}

export async function deleteFaq(db: Database, id: string, actor: Actor) {
  await db.delete(schema.faqs).where(eq(schema.faqs.id, id));
  await audit(db, audited(actor, "faq.delete", "faq", id));
}

export async function listAllFaqs(db: Database) {
  return db.select().from(schema.faqs).orderBy(asc(schema.faqs.category), asc(schema.faqs.sortOrder));
}

export async function saveAnnouncement(db: Database, input: { text: string; active: boolean }, actor: Actor) {
  const text = input.text.trim().slice(0, 200);
  const existing = await db.select().from(schema.announcements).limit(1);
  if (existing[0]) await db.update(schema.announcements).set({ text, active: input.active && text.length > 0 }).where(eq(schema.announcements.id, existing[0].id));
  else if (text) await db.insert(schema.announcements).values({ text, active: input.active });
  await audit(db, audited(actor, "announcement.update", "announcement", existing[0]?.id));
}

export async function getAnnouncementForEdit(db: Database) {
  return (await db.select().from(schema.announcements).limit(1))[0] ?? null;
}

/** WEB-09. Every edit creates a new version so earlier consents still point at the text that was accepted. */
export async function publishLegalPage(db: Database, input: { key: string; text: string }, actor: Actor) {
  if (!["privacy", "terms", "cookies", "cancellation"].includes(input.key)) throw new BookingError("POLICY", "Unknown page.");
  const [latest] = await db.select().from(schema.pages).where(eq(schema.pages.key, input.key)).orderBy(desc(schema.pages.version)).limit(1);
  const version = (latest?.version ?? 0) + 1;
  await db.insert(schema.pages).values({ key: input.key, title: latest?.title ?? input.key, body: { text: input.text.slice(0, 50_000) }, version, updatedBy: actor.id });
  await audit(db, audited(actor, "page.publish", "page", input.key, { version }));
  return version;
}

export async function listStaff(db: Database) {
  return db.select({
    id: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.users.role, isActive: schema.users.isActive,
    totpConfirmedAt: schema.users.totpConfirmedAt, lastLoginAt: schema.users.lastLoginAt,
  }).from(schema.users).orderBy(asc(schema.users.name));
}

export async function listAuditLog(db: Database, limit = 200) {
  return db.select().from(schema.auditLogs).orderBy(desc(schema.auditLogs.createdAt)).limit(Math.min(limit, 500));
}

