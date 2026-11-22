import { irishPublicHolidays } from "@rmc/core";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

type SeedDb = PgDatabase<PgQueryResultHKT, typeof schema>;

const TBD = "[TBD]";

/** Every value marked [TBD] is listed in docs/TBD.md and edited in admin. Nothing here is hard-coded in components. */
export const SETTINGS: Record<string, unknown> = {
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

// Names, prices and durations are placeholders. Prices are integer cents.
const SERVICES = [
  { slug: "gp-consultation", name: "GP consultation", category: "General", priceCents: 6000, durationMin: 15, bufferMin: 0, featured: true,
    shortDescription: "A standard appointment with the doctor for new or ongoing concerns." },
  { slug: "same-day-appointment", name: "Same-day appointment", category: "General", priceCents: 7000, durationMin: 15, bufferMin: 0, featured: true, minNoticeOverrideMin: 15,
    shortDescription: "Book a slot later today for a concern that cannot wait." },
  { slug: "childrens-consultation", name: "Children's consultation", category: "General", priceCents: 6000, durationMin: 15, bufferMin: 0, featured: true,
    shortDescription: "Appointments for babies, children and teenagers." },
  { slug: "health-check-up", name: "Health screening / check-up", category: "Preventive", priceCents: 12000, durationMin: 30, bufferMin: 5, featured: true,
    shortDescription: "A full check-up including blood pressure and a review of your health history." },
  { slug: "chronic-disease-review", name: "Chronic disease review", category: "Ongoing care", priceCents: 7500, durationMin: 20, bufferMin: 0, featured: false,
    shortDescription: "Regular reviews for conditions such as diabetes, asthma and high blood pressure." },
  { slug: "vaccinations", name: "Vaccinations", category: "Preventive", priceCents: 4500, durationMin: 15, bufferMin: 0, featured: false,
    shortDescription: "Routine, travel and seasonal vaccinations." },
  { slug: "minor-procedure", name: "Minor procedure", category: "Procedures", priceCents: 10000, durationMin: 30, bufferMin: 10, featured: false,
    shortDescription: "Minor in-clinic procedures. The doctor will confirm suitability first." },
  { slug: "medical-forms-certificates", name: "Medical forms and certificates (in clinic)", category: "Administration", priceCents: 5000, durationMin: 15, bufferMin: 0, featured: false,
    shortDescription: "Forms and certificates completed during an in-clinic visit." },
] as const;

const FAQS = [
  { category: "Booking", question: "How do I book an appointment?", answer: "Choose a service, pick a free time, enter your details and pay online or choose to pay at the clinic. You will receive a confirmation email straight away." },
  { category: "Booking", question: "Can I change or cancel my appointment?", answer: "Yes. Use the link in your confirmation email. Changes are free up to the cancellation window shown on the Prices page. After that, please call the clinic." },
  { category: "Payments", question: "How can I pay?", answer: "By card, Apple Pay or Google Pay when you book, or at the clinic where the service allows it." },
  { category: "Payments", question: "I have a medical card. How do I book?", answer: "[TBD] The clinic will confirm how medical card patients should book and pay." },
  { category: "Your visit", question: "Is this service for emergencies?", answer: "No. In an emergency call 112 or 999." },
  { category: "Your visit", question: "What should I bring?", answer: "Photo ID, your medical card if you have one, and a list of your current medications." },
] as const;

const LEGAL_PAGES = [
  { key: "privacy", title: "Privacy Policy" },
  { key: "terms", title: "Terms and Conditions" },
  { key: "cookies", title: "Cookie Policy" },
  { key: "cancellation", title: "Cancellation and Refund Policy" },
] as const;

/** Idempotent: safe to run many times. Existing rows are never overwritten (admin edits survive). */
export async function seed(db: SeedDb): Promise<void> {
  await db.transaction(async (tx) => {
    // Settings
    for (const [key, value] of Object.entries(SETTINGS)) {
      await tx.insert(schema.settings).values({ key, value }).onConflictDoNothing();
    }

    // Doctor, only when none exist
    const existing = await tx.select({ id: schema.doctors.id }).from(schema.doctors).limit(1);
    let doctorId = existing[0]?.id;
    if (!doctorId) {
      const [doc] = await tx.insert(schema.doctors).values({
        displayName: "Dr Khalid Siddig",
        title: "General Practitioner",
        bio: "[TBD] Doctor biography to be supplied by the clinic.",
        qualifications: "[TBD]",
        imcNumber: "[TBD]",
        languages: ["English"],
      }).returning({ id: schema.doctors.id });
      doctorId = doc!.id;

      // Mon to Fri, two sessions a day (placeholder hours). weekday 1..5
      for (let weekday = 1; weekday <= 5; weekday++) {
        await tx.insert(schema.availabilityRules).values([
          { doctorId, weekday, startTime: "09:00", endTime: "13:00" },
          { doctorId, weekday, startTime: "14:00", endTime: "17:30" },
        ]);
      }
    }

    // Services
    for (const [i, s] of SERVICES.entries()) {
      const [row] = await tx.insert(schema.services).values({ ...s, sortOrder: i, payAtClinicAllowed: true })
        .onConflictDoNothing({ target: schema.services.slug })
        .returning({ id: schema.services.id });
      if (row) {
        await tx.insert(schema.serviceDoctors).values({ serviceId: row.id, doctorId }).onConflictDoNothing();
      }
    }

    // Public holidays for this and next year (BK-15)
    const year = new Date().getUTCFullYear();
    for (const y of [year, year + 1]) {
      for (const h of irishPublicHolidays(y)) {
        await tx.insert(schema.clinicHolidays).values(h).onConflictDoNothing({ target: schema.clinicHolidays.date });
      }
    }

    // FAQs and legal pages only when the tables are empty
    const faqCount = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.faqs);
    if (!faqCount[0]?.n) {
      await tx.insert(schema.faqs).values(FAQS.map((f, i) => ({ ...f, sortOrder: i })));
    }
    for (const p of LEGAL_PAGES) {
      await tx.insert(schema.pages).values({
        key: p.key,
        title: p.title,
        body: { text: "[TBD] Template text. Must be reviewed by the clinic or a solicitor before launch." },
        version: 1,
      }).onConflictDoNothing();
    }
  });
}
