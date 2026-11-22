import { schema } from "@rmc/db";
import { and, asc, eq, isNull, notInArray } from "drizzle-orm";
import { audit } from "../audit";
import { buildIcs } from "../booking/ics";
import type { Database } from "../db-types";
import { formatEuro } from "../money";
import { loadAppointmentEmailData, looksLikeEmail, clinicRecipient, type AppointmentEmailData, type EmailEnv } from "./context";
import { loadTemplate, render, type Vars } from "./render";
import type { TemplateId } from "./templates";
import type { EmailAttachment, EmailTransport } from "./transport";
import { getClinicInfo } from "../content";

export interface OutboxDeps extends EmailEnv {
  transport: EmailTransport;
  now?: Date;
  maxEvents?: number;
}

const GIVE_UP_AFTER_MS = 48 * 3_600_000;
type Tx = Database;

interface Delivery {
  tx: Tx;
  deps: OutboxDeps;
  /** Unique per (appointment, type, recipient): the same email is never sent twice. */
  type: string;
  to: string | null;
  template: TemplateId;
  vars: Vars;
  appointmentId?: string;
  attachments?: EmailAttachment[];
  replyTo?: string;
}

/** Claims the notification row first (unique index), then sends. Returns true when an email went out. */
export async function deliver(d: Delivery): Promise<boolean> {
  if (!looksLikeEmail(d.to)) return false;
  const [claim] = await d.tx.insert(schema.notificationsSent).values({
    appointmentId: d.appointmentId ?? null, type: d.type, channel: "EMAIL", recipient: d.to, status: "PENDING",
  }).onConflictDoNothing().returning({ id: schema.notificationsSent.id });
  if (!claim) return false; // already sent

  const tpl = await loadTemplate(d.tx, d.template);
  const rendered = render(tpl, d.vars);
  const result = await d.deps.transport.send({
    to: d.to, subject: rendered.subject, text: rendered.text, html: rendered.html,
    replyTo: d.replyTo, attachments: d.attachments, idempotencyKey: `${d.type}:${d.appointmentId ?? "x"}:${d.to}`.slice(0, 200),
  });
  await d.tx.update(schema.notificationsSent).set({ status: "SENT", providerId: result.id, sentAt: d.deps.now ?? new Date() })
    .where(eq(schema.notificationsSent.id, claim.id));
  return true;
}

const icsFor = (data: AppointmentEmailData): EmailAttachment => ({
  filename: `${data.appointment.bookingRef}.ics`,
  contentType: "text/calendar",
  content: buildIcs({
    bookingRef: data.appointment.bookingRef, startAt: data.appointment.startAt, endAt: data.appointment.endAt,
    serviceName: String(data.vars.service), clinicName: data.clinic.name, clinicAddress: String(data.vars.clinicAddress),
    clinicPhone: String(data.vars.clinicPhone),
  }),
});

const REASON_TEXT: Record<string, string> = {
  slot_lost: "Sorry. Your payment went through, but the time you chose was taken by someone else a moment earlier, so we could not keep your booking.",
  payment_not_completed: "Your booking was not completed because the payment did not go through in time, so we have released the time.",
};

type EventRow = typeof schema.domainEvents.$inferSelect;

/** Turns one outbox event into its emails. Events with no email (check in, patient updated...) just return 0. */
async function handleEvent(tx: Tx, e: EventRow, deps: OutboxDeps): Promise<number> {
  const payload = (e.payload ?? {}) as Record<string, unknown>;
  let sent = 0;
  const send = async (x: Omit<Delivery, "tx" | "deps">) => { if (await deliver({ tx, deps, ...x })) sent++; };

  if (e.type === "enquiry.created") {
    const [enq] = await tx.select().from(schema.enquiries).where(eq(schema.enquiries.id, e.aggregateId));
    if (!enq) return 0;
    const clinic = await getClinicInfo(tx);
    const site = deps.siteUrl.replace(/\/$/, "");
    const vars: Vars = {
      senderName: enq.name, senderEmail: enq.email, senderPhone: enq.phone ?? "not given", message: enq.message,
      adminLink: `${site}/admin/enquiries`, clinicName: clinic.name, clinicPhone: clinic.phone.replace(/\s*\[TBD\]\s*/g, "").trim() || "the clinic",
    };
    await send({ type: `enquiry_alert:${e.id}`, to: clinicRecipient(clinic, deps), template: "contact_received", vars, replyTo: looksLikeEmail(enq.email) ? enq.email : undefined });
    await send({ type: `enquiry_autoreply:${e.id}`, to: enq.email, template: "contact_autoreply", vars });
    return sent;
  }

  if (e.type === "payment.refunded") {
    const appointmentId = String(payload.appointmentId ?? "");
    const data = await loadAppointmentEmailData(tx, appointmentId, deps);
    if (!data) return 0;
    const amount = typeof payload.amountCents === "number" ? formatEuro(payload.amountCents) : String(data.vars.amount);
    await send({ type: `refund_issued:${e.id}`, to: data.patientEmail, template: "refund_issued", appointmentId, vars: { ...data.vars, amount } });
    return sent;
  }

  if (!["appointment.confirmed", "appointment.rescheduled", "appointment.cancelled"].includes(e.type)) return 0;

  const data = await loadAppointmentEmailData(tx, e.aggregateId, deps);
  if (!data) return 0;
  const appointmentId = e.aggregateId;
  const alert = async (eventLabel: string) => {
    for (const to of new Set([data.clinicEmail, data.doctorEmail])) {
      await send({ type: `clinic_alert:${e.id}`, to, template: "clinic_alert", appointmentId, vars: { ...data.vars, eventLabel } });
    }
  };

  if (e.type === "appointment.confirmed") {
    await send({ type: "booking_confirmation", to: data.patientEmail, template: "booking_confirmation", appointmentId, vars: data.vars, attachments: [icsFor(data)] });
    await alert("New booking");
  } else if (e.type === "appointment.rescheduled") {
    await send({ type: `booking_rescheduled:${e.id}`, to: data.patientEmail, template: "booking_rescheduled", appointmentId, vars: data.vars, attachments: [icsFor(data)] });
    await alert("Booking moved");
  } else {
    const bySystem = payload.by === "SYSTEM";
    const refundDue = payload.refundDue === true;
    const refundNote = refundDue ? "Your payment will be refunded in full to the card you paid with. You will get another email when it is sent." : "";
    if (bySystem) {
      await send({
        type: `booking_not_completed:${e.id}`, to: data.patientEmail, template: "booking_not_completed", appointmentId,
        vars: { ...data.vars, reasonText: REASON_TEXT[String(payload.reason)] ?? "Your booking did not go ahead.", refundNote },
      });
    } else {
      await send({ type: `booking_cancelled:${e.id}`, to: data.patientEmail, template: "booking_cancelled", appointmentId, vars: { ...data.vars, refundNote, manageLink: deps.siteUrl.replace(/\/$/, "") + "/book" } });
      await alert("Booking cancelled");
    }
  }
  return sent;
}

export interface OutboxResult { processed: number; sent: number; failed: number; gaveUp: number }

/**
 * Sends the emails for every unprocessed domain event (EXT-03). Safe to run from several places at once:
 * each event is locked (`FOR UPDATE SKIP LOCKED`) while it is handled, and an email is claimed in the database
 * before it is sent. If sending fails, the whole event is rolled back and tried again on the next run,
 * and after 48 hours it is given up and written to the audit log.
 */
export async function processOutbox(db: Database, deps: OutboxDeps): Promise<OutboxResult> {
  const now = deps.now ?? new Date();
  const result: OutboxResult = { processed: 0, sent: 0, failed: 0, gaveUp: 0 };
  const skip: string[] = [];

  for (let i = 0; i < (deps.maxEvents ?? 50); i++) {
    let outcome = "none" as "none" | "done" | "failed"; // assigned inside the transaction callback
    let failedId: string | undefined;
    try {
      await db.transaction(async (tx) => {
        const [e] = await tx.select().from(schema.domainEvents)
          .where(and(isNull(schema.domainEvents.processedAt), skip.length ? notInArray(schema.domainEvents.id, skip) : undefined))
          .orderBy(asc(schema.domainEvents.occurredAt)).limit(1).for("update", { skipLocked: true });
        if (!e) return;
        failedId = e.id;
        result.sent += await handleEvent(tx, e, { ...deps, now });
        await tx.update(schema.domainEvents).set({ processedAt: now }).where(eq(schema.domainEvents.id, e.id));
        outcome = "done";
      });
    } catch {
      outcome = "failed"; // nothing about the message is logged: errors can contain the patient's address
    }

    if (outcome === "none") break;
    if (outcome === "done") { result.processed++; continue; }

    result.failed++;
    if (failedId) {
      skip.push(failedId);
      const [row] = await db.select().from(schema.domainEvents).where(eq(schema.domainEvents.id, failedId));
      if (row && now.getTime() - row.occurredAt.getTime() > GIVE_UP_AFTER_MS) {
        await db.update(schema.domainEvents).set({ processedAt: now }).where(eq(schema.domainEvents.id, failedId));
        await audit(db, { actorRole: "SYSTEM", action: "email.gave_up", entityType: "domain_event", entityId: failedId, changes: { type: row.type } });
        result.gaveUp++;
      }
    }
  }
  return result;
}

