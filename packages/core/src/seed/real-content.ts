import { schema } from "@rmc/db";
import { eq, notInArray } from "drizzle-orm";
import type { Database } from "../db-types";

/**
 * The clinic's real details, taken from the clinic's current website (royalclinicmedics.ie).
 * Run once after `db:seed` with `pnpm db:content`. It marks itself done so a second run does not
 * overwrite later edits made in the admin; pass `force` to apply it again on purpose.
 * Open questions about these values are listed in docs/TBD.md (items 21 to 30).
 */
const MARKER = "content.realApplied";

const SETTINGS: Record<string, string> = {
  "clinic.phone": "051 876531",
  "clinic.email": "info@drkhalid.ie",
  "clinic.address": "1st Floor over Careline Pharmacy, 29 Barronstrand St, Waterford",
  "clinic.eircode": "X91 W68E",
  "clinic.mapQuery": "Careline Pharmacy, 29 Barronstrand St, Waterford, X91 W68E",
  "clinic.openingHoursText": "Mon to Thu 08:00 to 18:00, Fri 08:00 to 17:00, Sat 09:00 to 13:00, Sun closed",
};

const SERVICES = [
  { slug: "gp-consultation", name: "GP Consultation", category: "Consultations", priceCents: 6000, durationMin: 15, bufferMin: 0, featured: true,
    shortDescription: "A standard in-person appointment with the doctor for new or ongoing concerns." },
  { slug: "phone-consultation", name: "Phone Consultation", category: "Consultations", priceCents: 6000, durationMin: 15, bufferMin: 0, featured: true,
    shortDescription: "The doctor phones you at your appointment time. Suitable for many everyday concerns." },
  { slug: "urgent-care", name: "Urgent Care", category: "Consultations", priceCents: 6000, durationMin: 15, bufferMin: 0, featured: true, minNoticeOverrideMin: 15,
    shortDescription: "A same-day appointment for a concern that cannot wait." },
  { slug: "blood-collection", name: "Blood Collection", category: "Tests", priceCents: 3000, durationMin: 15, bufferMin: 0, featured: true,
    shortDescription: "Blood tests taken at the clinic." },
  { slug: "sick-certificate", name: "Sick Certificate", category: "Certificates", priceCents: 6000, durationMin: 15, bufferMin: 0, featured: false,
    shortDescription: "A medical certificate issued after a consultation." },
] as const;

const FAQS = [
  { category: "Booking", question: "Do you accept medical cards?", answer: "Yes, medical card patients are welcome. Please phone the clinic before booking so we can confirm the correct fee and arrangements." },
  { category: "Your visit", question: "What if I need a specialist referral?", answer: "If you need to see a specialist, the doctor will arrange a referral for you during your consultation." },
  { category: "Payments", question: "How much does a consultation cost?", answer: "A GP consultation is €60. Every service shows its price before you book, with no hidden costs." },
  { category: "Booking", question: "Do you offer telemedicine or remote consultations?", answer: "Yes. Phone consultations are available for suitable concerns at €60." },
  { category: "Your visit", question: "How long will my appointment take?", answer: "Most consultations take 15 to 20 minutes. The length of each service is shown when you book." },
  { category: "Your visit", question: "What should I bring to my first appointment?", answer: "Please arrive 5 to 10 minutes early with photo ID and any relevant documents, such as referral letters or a list of your medications." },
  { category: "Booking", question: "Can I change or cancel my appointment?", answer: "Yes, free of charge up to 24 hours before, using the link in your confirmation email. Inside 24 hours please phone the clinic." },
  { category: "Your visit", question: "Is my health information private?", answer: "Yes. Your answers are seen only by the clinic team and are never sent by email." },
] as const;

// weekday: 0 = Sunday. Dublin wall-clock times.
const HOURS: [number, string, string][] = [
  [1, "08:00", "18:00"], [2, "08:00", "18:00"], [3, "08:00", "18:00"], [4, "08:00", "18:00"],
  [5, "08:00", "17:00"], [6, "09:00", "13:00"],
];

export async function applyRealContent(db: Database, opts: { force?: boolean } = {}): Promise<"applied" | "skipped"> {
  return db.transaction(async (tx) => {
    const done = await tx.select().from(schema.settings).where(eq(schema.settings.key, MARKER));
    if (done.length && !opts.force) return "skipped";

    for (const [key, value] of Object.entries(SETTINGS)) {
      await tx.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
    }

    // The doctor and opening hours
    const [doc] = await tx.select({ id: schema.doctors.id }).from(schema.doctors).orderBy(schema.doctors.sortOrder).limit(1);
    if (!doc) throw new Error("No doctor found. Run `pnpm db:seed` first.");
    await tx.update(schema.doctors).set({
      displayName: "Dr Khalid Siddig",
      title: "General Practitioner",
      bio: "An experienced General Practitioner with over a decade of practice, combining clinical excellence with a compassionate, patient-first approach.",
      qualifications: "MB BCh BAO, MRCGP, MICGP",
    }).where(eq(schema.doctors.id, doc.id));
    await tx.delete(schema.availabilityRules).where(eq(schema.availabilityRules.doctorId, doc.id));
    await tx.insert(schema.availabilityRules).values(HOURS.map(([weekday, startTime, endTime]) => ({ doctorId: doc.id, weekday, startTime, endTime })));

    // Services: upsert the five real ones, hide the placeholder ones (kept, not deleted, in case they have bookings)
    const keep = SERVICES.map((s) => s.slug) as string[];
    await tx.update(schema.services).set({ active: false, featured: false }).where(notInArray(schema.services.slug, keep));
    for (const [i, s] of SERVICES.entries()) {
      const values = { ...s, sortOrder: i, active: true, payAtClinicAllowed: true };
      const [row] = await tx.insert(schema.services).values(values)
        .onConflictDoUpdate({ target: schema.services.slug, set: { ...values, updatedAt: new Date() } })
        .returning({ id: schema.services.id });
      await tx.insert(schema.serviceDoctors).values({ serviceId: row!.id, doctorId: doc.id }).onConflictDoNothing();
    }

    // FAQs
    await tx.delete(schema.faqs);
    await tx.insert(schema.faqs).values(FAQS.map((f, i) => ({ ...f, sortOrder: i })));

    await tx.insert(schema.settings).values({ key: MARKER, value: new Date().toISOString() })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: new Date().toISOString(), updatedAt: new Date() } });
    return "applied";
  });
}
