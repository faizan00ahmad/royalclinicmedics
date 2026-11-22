import { schema } from "@rmc/db";
import { desc, eq } from "drizzle-orm";
import { audit } from "../audit";
import type { Actor } from "../admin/appointments";
import { BookingError } from "../booking/errors";
import { getClinicInfo } from "../content";
import type { Database } from "../db-types";
import { looksLikeEmail } from "./context";
import { loadTemplate, render } from "./render";
import { DEFAULT_TEMPLATES, TEMPLATE_IDS, VARIABLES, type TemplateId } from "./templates";
import type { EmailTransport } from "./transport";

const isId = (id: string): id is TemplateId => (TEMPLATE_IDS as string[]).includes(id);

export async function listTemplates(db: Database) {
  return Promise.all(TEMPLATE_IDS.map(async (id) => {
    const t = await loadTemplate(db, id);
    return { id, ...DEFAULT_TEMPLATES[id], subject: t.subject, body: t.body, customised: t.customised, defaultSubject: DEFAULT_TEMPLATES[id].subject, defaultBody: DEFAULT_TEMPLATES[id].body };
  }));
}

/** Only known variables are allowed, so nothing can be added that pulls in health information (SEC-07). */
export function unknownVariables(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!))].filter((v) => !(v in VARIABLES));
}

export async function saveTemplate(db: Database, input: { id: string; subject: string; body: string }, actor: Actor): Promise<void> {
  if (!isId(input.id)) throw new BookingError("POLICY", "Unknown email.");
  const subject = input.subject.replace(/[\r\n]+/g, " ").trim();
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (subject.length < 3 || subject.length > 200) throw new BookingError("POLICY", "The subject must be 3 to 200 characters.");
  if (body.length < 10 || body.length > 5000) throw new BookingError("POLICY", "The message must be 10 to 5000 characters.");
  const bad = unknownVariables(subject + " " + body);
  if (bad.length) throw new BookingError("POLICY", `These placeholders are not allowed: ${bad.map((b) => `{{${b}}}`).join(", ")}.`);
  await db.insert(schema.settings).values({ key: `email.template.${input.id}`, value: { subject, body } })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: { subject, body }, updatedAt: new Date() } });
  await audit(db, { actorUserId: actor.id, actorRole: actor.role, action: "email.template_save", entityType: "email_template", entityId: input.id, ip: actor.ip });
}

export async function resetTemplate(db: Database, id: string, actor: Actor): Promise<void> {
  if (!isId(id)) throw new BookingError("POLICY", "Unknown email.");
  await db.delete(schema.settings).where(eq(schema.settings.key, `email.template.${id}`));
  await audit(db, { actorUserId: actor.id, actorRole: actor.role, action: "email.template_reset", entityType: "email_template", entityId: id, ip: actor.ip });
}

const SAMPLE = {
  firstName: "Aoife", patientName: "Aoife Murphy", service: "GP consultation", doctor: "Dr Khalid Siddig", date: "Mon 30 Nov 2026", time: "10:30",
  ref: "RMC-TEST23", manageLink: "https://example.com/booking/RMC-TEST23#token=sample", calendarLink: "https://example.com/calendar",
  adminLink: "https://example.com/admin", paymentNote: "Please pay €60.00 at the clinic.", amount: "€60.00", reminderLead: "tomorrow",
  refundNote: "Your payment will be refunded in full.", reasonText: "Your booking did not go ahead.", eventLabel: "New booking", source: "online",
  senderName: "Liam Byrne", senderEmail: "liam@example.com", senderPhone: "+353 85 000 0000", message: "Do you open on Saturdays?",
};

/** AD-12 "send test". Uses made-up booking details so no real patient data is involved. */
export async function sendTestEmail(db: Database, transport: EmailTransport, input: { id: string; to: string }, actor: Actor): Promise<void> {
  if (!isId(input.id)) throw new BookingError("POLICY", "Unknown email.");
  if (!looksLikeEmail(input.to)) throw new BookingError("POLICY", "Enter a valid email address.");
  const clinic = await getClinicInfo(db);
  const tpl = await loadTemplate(db, input.id);
  const r = render(tpl, { ...SAMPLE, cancellationHours: clinic.cancellationWindowHours, clinicName: clinic.name, clinicPhone: clinic.phone.replace(/\s*\[TBD\]\s*/g, "").trim() || "the clinic", clinicAddress: clinic.address.replace(/\s*\[TBD\]\s*/g, "").trim() });
  await transport.send({ to: input.to, subject: `[TEST] ${r.subject}`, text: r.text, html: r.html });
  await audit(db, { actorUserId: actor.id, actorRole: actor.role, action: "email.test_sent", entityType: "email_template", entityId: input.id, ip: actor.ip });
}

export async function listRecentEmails(db: Database, limit = 50) {
  return db.select().from(schema.notificationsSent).orderBy(desc(schema.notificationsSent.sentAt)).limit(Math.min(limit, 200));
}
