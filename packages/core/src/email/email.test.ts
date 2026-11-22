import { schema } from "@rmc/db";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createStaffBooking, saveSettings, type Actor } from "../admin";
import {
  cancelAppointment, confirmAppointment, createHold, resolveAppointmentByToken, rescheduleAppointment, emitEvent,
} from "../booking";
import { cancelWithRefund, expireUnpaidAppointments, processStripeEvent, startOnlineCheckout } from "../payments";
import { seed } from "../seed/seed";
import { FakeGateway, succeededEvent } from "../test-utils/fake-gateway";
import { createTestDb } from "../test-utils/pglite";
import { dublinToUtc } from "../time";
import { MemoryTransport, fill, processOutbox, render, sendDueReminders } from "./index";

const NOW = dublinToUtc("2026-11-20 08:00");
const at = (hhmm: string, date = "2026-11-24") => dublinToUtc(`${date} ${hhmm}`);
const actor: Actor = { id: "00000000-0000-4000-8000-000000000001", role: "ADMIN" };
const PATIENT = { firstName: "Aoife", lastName: "Murphy", dob: "1990-04-12", email: "aoife@example.com", phone: "+353871234567" };
const SITE = "https://clinic.example";

let ctx: Awaited<ReturnType<typeof createTestDb>> & { doctorId: string; serviceId: string; mail: MemoryTransport; gw: FakeGateway };
const deps = (now = NOW) => ({ transport: ctx.mail, siteUrl: SITE, now });

beforeEach(async () => {
  const t = await createTestDb();
  await seed(t.db);
  const [d] = await t.db.select().from(schema.doctors);
  const [s] = await t.db.select().from(schema.services).where(eq(schema.services.slug, "gp-consultation"));
  ctx = { ...t, doctorId: d!.id, serviceId: s!.id, mail: new MemoryTransport(), gw: new FakeGateway() };
  await saveSettings(t.db, { "clinic.email": "reception@clinic.example", "clinic.phone": "+353 1 555 0100", "clinic.address": "1 Main Street, Dublin 2" }, actor);
});

const book = async (hhmm = "09:00", extra: Partial<Parameters<typeof confirmAppointment>[1]> = {}) => {
  const h = await createHold(ctx.db, { serviceId: ctx.serviceId, doctorId: ctx.doctorId, startAt: at(hhmm), now: NOW });
  return (await confirmAppointment(ctx.db, {
    holdId: h.id, patient: PATIENT, paymentChoice: "AT_CLINIC", now: NOW,
    reason: "SECRET-REASON", questionnaire: { symptoms: "SECRET-SYMPTOM", allergies: { has: true, details: "SECRET-ALLERGY" } }, ...extra,
  })).appointment;
};
const to = (addr: string) => ctx.mail.sent.filter((m) => m.to === addr);

describe("templating", () => {
  it("fills variables in one pass and never re-expands a value", () => {
    expect(fill("Hi {{firstName}} {{ref}}", { firstName: "{{ref}}", ref: "RMC-1" })).toBe("Hi {{ref}} RMC-1");
    expect(fill("{{unknown}}x", {})).toBe("x");
  });
  it("escapes HTML and cannot be used to inject markup or extra headers", () => {
    const r = render({ subject: "Hello {{name}}", body: "Name: {{name}}\n\nLink: https://a.example/x" }, { name: "<script>alert(1)</script>\r\nBcc: evil@x.com", clinicName: "C" });
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.subject).not.toMatch(/[\r\n]/);
    expect(r.html).toContain('<a href="https://a.example/x"');
  });
});

describe("booking confirmation", () => {
  it("emails the patient a confirmation with working manage link and calendar file, and alerts the clinic", async () => {
    const a = await book();
    const res = await processOutbox(ctx.db, deps());
    expect(res.failed).toBe(0);

    const [mail] = to("aoife@example.com");
    expect(mail!.subject).toContain(a.bookingRef);
    expect(mail!.text).toContain("Tue 24 Nov 2026 at 09:00");
    expect(mail!.text).toContain("1 Main Street, Dublin 2");
    expect(mail!.text).toContain("Please pay €60.00 at the clinic.");
    expect(mail!.attachments?.[0]?.filename).toBe(`${a.bookingRef}.ics`);
    expect(String(mail!.attachments?.[0]?.content)).toContain("BEGIN:VCALENDAR");

    // the link in the email really opens this booking
    const link = mail!.text.match(/https:\/\/clinic\.example\/booking\/(RMC-[A-Z0-9]+)#token=(\S+)/)!;
    expect((await resolveAppointmentByToken(ctx.db, link[1]!, link[2]!))?.id).toBe(a.id);

    const alert = to("reception@clinic.example")[0]!;
    expect(alert.subject).toContain("New booking");
    expect(alert.text).toContain(`${SITE}/admin/appointments/${a.id}`);
  });

  it("never contains health information or the reason for the visit (SEC-07)", async () => {
    await book();
    await processOutbox(ctx.db, deps());
    expect(ctx.mail.sent.length).toBeGreaterThanOrEqual(2);
    const everything = JSON.stringify(ctx.mail.sent);
    for (const secret of ["SECRET-REASON", "SECRET-SYMPTOM", "SECRET-ALLERGY"]) expect(everything).not.toContain(secret);
  });

  it("is sent once, even if the dispatcher runs again or twice at the same time", async () => {
    await book();
    await Promise.all([processOutbox(ctx.db, deps()), processOutbox(ctx.db, deps())]);
    await processOutbox(ctx.db, deps());
    expect(to("aoife@example.com")).toHaveLength(1);
    expect(to("reception@clinic.example")).toHaveLength(1);
  });

  it("also alerts the doctor when the doctor has a login", async () => {
    const [u] = await ctx.db.insert(schema.users).values({ email: "dr@clinic.example", name: "Dr K", role: "DOCTOR", passwordHash: "x" }).returning();
    await ctx.db.update(schema.doctors).set({ userId: u!.id }).where(eq(schema.doctors.id, ctx.doctorId));
    await book();
    await processOutbox(ctx.db, deps());
    expect(to("dr@clinic.example")).toHaveLength(1);
  });

  it("an online booking is emailed only once payment confirms it", async () => {
    const h = await createHold(ctx.db, { serviceId: ctx.serviceId, doctorId: ctx.doctorId, startAt: at("10:00"), now: NOW });
    const co = await startOnlineCheckout(ctx.db, ctx.gw, { holdId: h.id, patient: PATIENT, now: NOW });
    await processOutbox(ctx.db, deps());
    expect(ctx.mail.sent).toHaveLength(0);
    await processStripeEvent(ctx.db, ctx.gw, succeededEvent("evt_1", co.paymentIntentId, co.amountCents), NOW);
    await processOutbox(ctx.db, deps());
    expect(to("aoife@example.com")[0]!.text).toContain("Payment received: €60.00");
  });

  it("walk-ins without an email get no patient email but the clinic still hears", async () => {
    await createStaffBooking(ctx.db, { serviceId: ctx.serviceId, doctorId: ctx.doctorId, startAt: at("10:00"), patient: { ...PATIENT, email: "" }, paymentChoice: "AT_CLINIC", actor, now: NOW });
    await processOutbox(ctx.db, deps());
    expect(to("aoife@example.com")).toHaveLength(0);
    expect(to("reception@clinic.example")).toHaveLength(1);
  });

  it("works with no clinic email configured: patient is still emailed, no crash", async () => {
    await ctx.db.update(schema.settings).set({ value: "[TBD]" }).where(eq(schema.settings.key, "clinic.email"));
    await book();
    const res = await processOutbox(ctx.db, deps());
    expect(res.failed).toBe(0);
    expect(ctx.mail.sent.map((m) => m.to)).toEqual(["aoife@example.com"]);
  });

  it("falls back to CLINIC_NOTIFY_EMAIL while the clinic email is a placeholder", async () => {
    await ctx.db.update(schema.settings).set({ value: "[TBD]" }).where(eq(schema.settings.key, "clinic.email"));
    await book();
    await processOutbox(ctx.db, { ...deps(), clinicNotifyFallback: "owner@example.com" });
    expect(to("owner@example.com")).toHaveLength(1);
  });

  it("a name containing line breaks cannot alter the subject", async () => {
    await book("09:00", { patient: { ...PATIENT, lastName: "Murphy\r\nBcc: evil@x.com" } });
    await processOutbox(ctx.db, deps());
    for (const m of ctx.mail.sent) expect(m.subject).not.toMatch(/[\r\n]/);
  });
});

describe("changes and cancellations", () => {
  it("each reschedule sends its own email", async () => {
    const a = await book();
    await processOutbox(ctx.db, deps());
    await rescheduleAppointment(ctx.db, { appointmentId: a.id, newStartAt: at("11:00"), by: "PATIENT", now: NOW });
    await processOutbox(ctx.db, deps());
    await rescheduleAppointment(ctx.db, { appointmentId: a.id, newStartAt: at("11:30"), by: "PATIENT", now: NOW });
    await processOutbox(ctx.db, deps());
    const moved = to("aoife@example.com").filter((m) => m.subject.includes("moved"));
    expect(moved).toHaveLength(2);
    expect(moved[1]!.text).toContain("11:30");
  });

  it("cancellation emails the patient; a paid cancellation by the clinic also sends the refund email", async () => {
    const h = await createHold(ctx.db, { serviceId: ctx.serviceId, doctorId: ctx.doctorId, startAt: at("10:00"), now: NOW });
    const co = await startOnlineCheckout(ctx.db, ctx.gw, { holdId: h.id, patient: PATIENT, now: NOW });
    await processStripeEvent(ctx.db, ctx.gw, succeededEvent("evt_1", co.paymentIntentId, co.amountCents), NOW);
    await processOutbox(ctx.db, deps());
    ctx.mail.sent.length = 0;

    await cancelWithRefund(ctx.db, ctx.gw, { appointmentId: co.appointmentId, by: "CLINIC", now: NOW });
    await processOutbox(ctx.db, deps());
    const patientMail = to("aoife@example.com");
    expect(patientMail.map((m) => m.subject).sort()).toEqual(["Your appointment on Tue 24 Nov 2026 has been cancelled", "Your refund from Royal Medics Clinic"]);
    expect(patientMail.find((m) => m.subject.includes("cancelled"))!.text).toContain("refunded in full");
    expect(patientMail.find((m) => m.subject.includes("refund"))!.text).toContain("€60.00");
  });

  it("unpaid pay-at-clinic cancellation has no refund wording", async () => {
    const a = await book();
    await processOutbox(ctx.db, deps());
    await cancelAppointment(ctx.db, { appointmentId: a.id, by: "PATIENT", now: NOW });
    await processOutbox(ctx.db, deps());
    const mail = to("aoife@example.com").find((m) => m.subject.includes("cancelled"))!;
    expect(mail.text).not.toContain("refunded");
  });

  it("paid but the slot was lost: patient is told it did not go ahead and that they are refunded", async () => {
    const h = await createHold(ctx.db, { serviceId: ctx.serviceId, doctorId: ctx.doctorId, startAt: at("09:00"), now: NOW });
    const co = await startOnlineCheckout(ctx.db, ctx.gw, { holdId: h.id, patient: PATIENT, now: NOW });
    const later = new Date(NOW.getTime() + 15 * 60_000);
    const other = await createHold(ctx.db, { serviceId: ctx.serviceId, doctorId: ctx.doctorId, startAt: at("09:00"), now: later });
    await confirmAppointment(ctx.db, { holdId: other.id, patient: { ...PATIENT, firstName: "Sean", email: "sean@example.com", dob: "1980-01-01" }, paymentChoice: "AT_CLINIC", now: later });
    await processStripeEvent(ctx.db, ctx.gw, succeededEvent("evt_1", co.paymentIntentId, co.amountCents), later);
    await processOutbox(ctx.db, deps(later));
    const mail = to("aoife@example.com").find((m) => m.subject.includes("did not go ahead"))!;
    expect(mail.text).toContain("taken by someone else");
    expect(mail.text).toContain("refunded in full");
  });

  it("an abandoned checkout cleaned up by the cron job tells the patient", async () => {
    const h = await createHold(ctx.db, { serviceId: ctx.serviceId, doctorId: ctx.doctorId, startAt: at("09:00"), now: NOW });
    await startOnlineCheckout(ctx.db, ctx.gw, { holdId: h.id, patient: PATIENT, now: NOW });
    const later = new Date(NOW.getTime() + 45 * 60_000);
    await expireUnpaidAppointments(ctx.db, ctx.gw, later);
    await processOutbox(ctx.db, deps(later));
    expect(to("aoife@example.com")[0]!.text).toContain("payment did not go through in time");
  });
});

describe("failures and retries", () => {
  it("a provider outage leaves the event for the next run and never duplicates", async () => {
    await book();
    ctx.mail.failNext = 1;
    const first = await processOutbox(ctx.db, deps());
    expect(first.failed).toBe(1);
    expect(first.processed).toBe(1); // the patient.updated event needs no email
    expect((await ctx.db.select().from(schema.domainEvents).where(eq(schema.domainEvents.type, "appointment.confirmed")))[0]!.processedAt).toBeNull();
    expect(await ctx.db.select().from(schema.notificationsSent)).toHaveLength(0); // claim rolled back

    const second = await processOutbox(ctx.db, deps());
    expect(second.failed).toBe(0);
    expect(to("aoife@example.com")).toHaveLength(1);
  });

  it("gives up after 48 hours and records it in the audit log", async () => {
    await book();
    await ctx.db.update(schema.domainEvents).set({ occurredAt: NOW });
    ctx.mail.failNext = 99;
    const late = new Date(NOW.getTime() + 49 * 3_600_000);
    const res = await processOutbox(ctx.db, deps(late));
    expect(res.gaveUp).toBeGreaterThan(0);
    expect((await ctx.db.select().from(schema.auditLogs)).map((a) => a.action)).toContain("email.gave_up");
    ctx.mail.failNext = 0;
    expect((await processOutbox(ctx.db, deps(late))).processed).toBe(0); // nothing left to send
  });

  it("a failing event does not block the ones behind it", async () => {
    await book("09:00");
    await book("09:15", { patient: { ...PATIENT, firstName: "Sean", email: "sean@example.com", dob: "1980-01-01" } });
    ctx.mail.failNext = 1; // first event's first email fails
    const res = await processOutbox(ctx.db, deps());
    expect(res.failed).toBe(1);
    expect(res.processed).toBe(3); // every other event still went through
    expect(ctx.mail.sent.length).toBeGreaterThan(0);
  });
});

describe("reminders", () => {
  it("sends the 24 hour and 2 hour reminders once each", async () => {
    const a = await book();
    await processOutbox(ctx.db, deps());
    ctx.mail.sent.length = 0;

    const before = dublinToUtc("2026-11-22 10:00"); // 47 hours before
    expect((await sendDueReminders(ctx.db, deps(before))).sent).toBe(0);
    const day = dublinToUtc("2026-11-23 08:30"); // 24.5h before: not yet
    expect((await sendDueReminders(ctx.db, deps(day))).sent).toBe(0);
    const t24 = dublinToUtc("2026-11-23 09:30"); // 23.5h before
    expect((await sendDueReminders(ctx.db, deps(t24))).sent).toBe(1);
    expect((await sendDueReminders(ctx.db, deps(t24))).sent).toBe(0); // once only
    const t2 = dublinToUtc("2026-11-24 07:30"); // 1.5h before
    expect((await sendDueReminders(ctx.db, deps(t2))).sent).toBe(1);

    const [r24, r2] = ctx.mail.sent;
    expect(r24!.subject).toContain("tomorrow");
    expect(r2!.subject).toContain("in about 2 hours");
    expect(r24!.text).toContain(a.bookingRef.length ? "Need to change it?" : "");
    expect(JSON.stringify(ctx.mail.sent)).not.toContain("SECRET");
  });

  it("does not send reminders after the appointment has started, or for cancelled or unpaid-online bookings", async () => {
    const a = await book();
    const h = await createHold(ctx.db, { serviceId: ctx.serviceId, doctorId: ctx.doctorId, startAt: at("10:00"), now: NOW });
    await startOnlineCheckout(ctx.db, ctx.gw, { holdId: h.id, patient: { ...PATIENT, email: "pending@example.com", firstName: "Pat" }, now: NOW }); // pending payment
    await cancelAppointment(ctx.db, { appointmentId: a.id, by: "CLINIC", now: NOW });
    ctx.mail.sent.length = 0;
    expect((await sendDueReminders(ctx.db, deps(dublinToUtc("2026-11-24 08:00")))).sent).toBe(0);
    expect(ctx.mail.sent).toHaveLength(0);
  });

  it("skips a reminder for a booking made inside that window", async () => {
    const soon = dublinToUtc("2026-11-24 06:00"); // booked 3 hours before
    const h = await createHold(ctx.db, { serviceId: ctx.serviceId, doctorId: ctx.doctorId, startAt: at("09:00"), now: soon });
    const appt = (await confirmAppointment(ctx.db, { holdId: h.id, patient: PATIENT, paymentChoice: "AT_CLINIC", now: soon })).appointment;
    await ctx.db.update(schema.appointments).set({ createdAt: soon }).where(eq(schema.appointments.id, appt.id));
    ctx.mail.sent.length = 0;
    const res = await sendDueReminders(ctx.db, deps(dublinToUtc("2026-11-24 07:30")));
    expect(res.sent).toBe(1); // only the 2 hour one; the 24 hour one is skipped
    expect(ctx.mail.sent[0]!.subject).toContain("2 hours");
  });

  it("uses reminder hours from settings", async () => {
    await ctx.db.insert(schema.settings).values({ key: "notifications.reminderHours", value: [48] }).onConflictDoUpdate({ target: schema.settings.key, set: { value: [48] } });
    await book();
    await ctx.db.update(schema.appointments).set({ createdAt: NOW });
    ctx.mail.sent.length = 0;
    expect((await sendDueReminders(ctx.db, deps(dublinToUtc("2026-11-22 12:00")))).sent).toBe(1);
    expect(ctx.mail.sent[0]!.subject).toContain("in 2 days");
  });
});

describe("contact form emails", () => {
  it("alerts the clinic with a reply-to and auto-replies to the sender", async () => {
    const [enq] = await ctx.db.insert(schema.enquiries).values({ name: "Liam", email: "liam@example.com", message: "Open on Saturdays?" }).returning();
    await emitEvent(ctx.db, { type: "enquiry.created", aggregateType: "enquiry", aggregateId: enq!.id });
    await processOutbox(ctx.db, deps());
    const alert = to("reception@clinic.example")[0]!;
    expect(alert.replyTo).toBe("liam@example.com");
    expect(alert.text).toContain("Open on Saturdays?");
    expect(to("liam@example.com")[0]!.subject).toBe("We received your message");
  });
});

describe("editable templates (AD-12)", () => {
  it("uses the clinic's own wording once saved, and falls back when blank", async () => {
    await ctx.db.insert(schema.settings).values({ key: "email.template.booking_confirmation", value: { subject: "Confirmed {{ref}}", body: "Hi {{firstName}}, see you on {{date}}." } });
    await book();
    await processOutbox(ctx.db, deps());
    const mail = to("aoife@example.com")[0]!;
    expect(mail.subject).toMatch(/^Confirmed RMC-/);
    expect(mail.text).toBe("Hi Aoife, see you on Tue 24 Nov 2026.");

    await ctx.db.update(schema.settings).set({ value: { subject: "", body: "" } }).where(eq(schema.settings.key, "email.template.booking_confirmation"));
    await book("09:15");
    await processOutbox(ctx.db, deps());
    expect(to("aoife@example.com")[1]!.subject).toContain("is confirmed");
  });
});

describe("template editor (AD-12)", () => {
  it("saves, lists as customised, and resets", async () => {
    const { saveTemplate, listTemplates, resetTemplate } = await import("./index");
    await saveTemplate(ctx.db, { id: "reminder", subject: "See you {{reminderLead}}", body: "Hi {{firstName}}, your visit is {{date}} at {{time}}." }, actor);
    const t = (await listTemplates(ctx.db)).find((x) => x.id === "reminder")!;
    expect(t.customised).toBe(true);
    expect(t.subject).toBe("See you {{reminderLead}}");
    await resetTemplate(ctx.db, "reminder", actor);
    expect((await listTemplates(ctx.db)).find((x) => x.id === "reminder")!.customised).toBe(false);
  });

  it("rejects placeholders that could expose health information, and bad input", async () => {
    const { saveTemplate } = await import("./index");
    await expect(saveTemplate(ctx.db, { id: "reminder", subject: "Hello", body: "Your symptoms: {{symptoms}} and {{questionnaire}}" }, actor)).rejects.toMatchObject({ code: "POLICY" });
    await expect(saveTemplate(ctx.db, { id: "reminder", subject: "x", body: "long enough body here" }, actor)).rejects.toMatchObject({ code: "POLICY" });
    await expect(saveTemplate(ctx.db, { id: "nope", subject: "Hello there", body: "long enough body here" }, actor)).rejects.toMatchObject({ code: "POLICY" });
  });

  it("sends a test with made-up details and an obvious TEST marker", async () => {
    const { sendTestEmail } = await import("./index");
    await sendTestEmail(ctx.db, ctx.mail, { id: "booking_confirmation", to: "me@example.com" }, actor);
    expect(ctx.mail.sent[0]!.subject.startsWith("[TEST]")).toBe(true);
    expect(ctx.mail.sent[0]!.text).toContain("RMC-TEST23");
    await expect(sendTestEmail(ctx.db, ctx.mail, { id: "booking_confirmation", to: "not-an-email" }, actor)).rejects.toMatchObject({ code: "POLICY" });
  });
});
