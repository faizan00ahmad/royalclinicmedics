import { schema } from "@rmc/db";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { seed } from "../seed/seed";
import { dublinToUtc } from "../time";
import { createTestDb } from "../test-utils/pglite";
import {
  BookingError, SlotTakenError, cancelAppointment, confirmAppointment, createHold, findOrCreatePatient,
  generateBookingRef, getAvailability, rescheduleAppointment, verifyManageToken,
} from "./index";

// Friday 20 Nov 2026. Winter, so Dublin wall clock equals UTC.
const NOW = dublinToUtc("2026-11-20 08:00");
const TUE = "2026-11-24";
const at = (hhmm: string, date = TUE) => dublinToUtc(`${date} ${hhmm}`);

const PATIENT = {
  firstName: "Aoife", lastName: "Murphy", dob: "1990-04-12", email: "Aoife@Example.com", phone: "+353871234567",
};

async function setup() {
  const { client, db } = await createTestDb();
  await seed(db);
  const [doctor] = await db.select().from(schema.doctors);
  const services = await db.select().from(schema.services);
  const svc = (slug: string) => services.find((s) => s.slug === slug)!;
  return { client, db, doctorId: doctor!.id, svc };
}

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { ctx = await setup(); });

const startTimes = async (serviceId: string, date = TUE) =>
  (await getAvailability(ctx.db, { serviceId, fromDate: date, toDate: date, now: NOW }))
    .map((s) => s.startAt.toISOString().slice(11, 16));

describe("availability from the database", () => {
  it("returns seeded working hours", async () => {
    const t = await startTimes(ctx.svc("gp-consultation").id);
    expect(t[0]).toBe("09:00");
    expect(t).toHaveLength(30);
  });

  it("returns nothing on a public holiday", async () => {
    expect(await startTimes(ctx.svc("gp-consultation").id, "2026-12-25")).toHaveLength(0);
  });
});

describe("holds and the double-booking guard", () => {
  it("a hold removes the slot from availability", async () => {
    const svc = ctx.svc("gp-consultation");
    await createHold(ctx.db, { serviceId: svc.id, doctorId: ctx.doctorId, startAt: at("09:00"), now: NOW });
    expect(await startTimes(svc.id)).not.toContain("09:00");
  });

  it("second hold on the same slot fails with SlotTakenError", async () => {
    const svc = ctx.svc("gp-consultation");
    const args = { serviceId: svc.id, doctorId: ctx.doctorId, startAt: at("09:00"), now: NOW };
    await createHold(ctx.db, args);
    await expect(createHold(ctx.db, args)).rejects.toBeInstanceOf(SlotTakenError);
  });

  it("two simultaneous requests: exactly one wins", async () => {
    const svc = ctx.svc("gp-consultation");
    const args = { serviceId: svc.id, doctorId: ctx.doctorId, startAt: at("10:00"), now: NOW };
    const results = await Promise.allSettled([createHold(ctx.db, args), createHold(ctx.db, args)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(SlotTakenError);
    const locks = await ctx.client.query(`SELECT 1 FROM core.slot_locks`);
    expect(locks.rows).toHaveLength(1);
  });

  it("rejects a time that is not a real slot (outside hours)", async () => {
    const svc = ctx.svc("gp-consultation");
    await expect(createHold(ctx.db, { serviceId: svc.id, doctorId: ctx.doctorId, startAt: at("03:00"), now: NOW }))
      .rejects.toBeInstanceOf(SlotTakenError);
  });

  it("an expired hold frees the slot", async () => {
    const svc = ctx.svc("gp-consultation");
    await createHold(ctx.db, { serviceId: svc.id, doctorId: ctx.doctorId, startAt: at("09:00"), now: NOW });
    const later = new Date(NOW.getTime() + 11 * 60_000); // hold is 10 minutes
    const hold2 = await createHold(ctx.db, { serviceId: svc.id, doctorId: ctx.doctorId, startAt: at("09:00"), now: later });
    expect(hold2.status).toBe("ACTIVE");
  });

  it("buffer after an appointment blocks the next slot (BK-13)", async () => {
    const svc = ctx.svc("minor-procedure"); // 30 min + 10 min buffer
    await createHold(ctx.db, { serviceId: svc.id, doctorId: ctx.doctorId, startAt: at("09:00"), now: NOW });
    const gp = ctx.svc("gp-consultation");
    const t = await startTimes(gp.id);
    expect(t).not.toContain("09:30"); // inside the 30 min appointment
    expect(t).not.toContain("09:30");
    expect(t).toContain("09:45"); // lock ends 09:40, next 15-minute step is 09:45
  });
});

describe("confirming an appointment", () => {
  const holdFor = async (slug = "gp-consultation", hhmm = "09:00") => {
    const svc = ctx.svc(slug);
    return createHold(ctx.db, { serviceId: svc.id, doctorId: ctx.doctorId, startAt: at(hhmm), now: NOW });
  };

  it("pay at clinic: CONFIRMED, UNPAID, lock converted, hold consumed, event written", async () => {
    const hold = await holdFor();
    const { appointment, manageToken } = await confirmAppointment(ctx.db, {
      holdId: hold.id, patient: PATIENT, paymentChoice: "AT_CLINIC", now: NOW,
      questionnaire: { symptoms: "cough" },
    });
    expect(appointment.status).toBe("CONFIRMED");
    expect(appointment.paymentStatus).toBe("UNPAID");
    expect(appointment.bookingRef).toMatch(/^RMC-[A-HJ-NP-Z2-9]{6}$/);
    expect(appointment.manageTokenHash).not.toBe(manageToken);
    expect(verifyManageToken(manageToken, appointment.manageTokenHash)).toBe(true);
    expect(verifyManageToken("wrong", appointment.manageTokenHash)).toBe(false);

    const [lock] = await ctx.db.select().from(schema.slotLocks);
    expect(lock!.kind).toBe("APPOINTMENT");
    expect(lock!.appointmentId).toBe(appointment.id);
    expect(lock!.holdId).toBeNull();

    const [h] = await ctx.db.select().from(schema.slotHolds).where(eq(schema.slotHolds.id, hold.id));
    expect(h!.status).toBe("CONSUMED");

    const events = await ctx.db.select().from(schema.domainEvents);
    expect(events.map((e) => e.type)).toContain("appointment.confirmed");
    // SEC-07: no health data in events
    expect(JSON.stringify(events)).not.toContain("cough");
  });

  it("online payment: PAID with a payments row and payment.succeeded event", async () => {
    const hold = await holdFor();
    const { appointment } = await confirmAppointment(ctx.db, {
      holdId: hold.id, patient: PATIENT, paymentChoice: "ONLINE", now: NOW,
      payment: { stripePaymentIntentId: "pi_test_123", method: "APPLE_PAY" },
    });
    expect(appointment.paymentStatus).toBe("PAID");
    const pays = await ctx.db.select().from(schema.payments);
    expect(pays).toHaveLength(1);
    expect(pays[0]!.amountCents).toBe(appointment.totalCents);
    const events = await ctx.db.select().from(schema.domainEvents);
    expect(events.map((e) => e.type)).toContain("payment.succeeded");
  });

  it("online choice without a payment is refused", async () => {
    const hold = await holdFor();
    await expect(confirmAppointment(ctx.db, { holdId: hold.id, patient: PATIENT, paymentChoice: "ONLINE", now: NOW }))
      .rejects.toMatchObject({ code: "POLICY" });
  });

  it("pay at clinic is refused when the service does not allow it", async () => {
    const svc = ctx.svc("gp-consultation");
    await ctx.db.update(schema.services).set({ payAtClinicAllowed: false }).where(eq(schema.services.id, svc.id));
    const hold = await holdFor();
    await expect(confirmAppointment(ctx.db, { holdId: hold.id, patient: PATIENT, paymentChoice: "AT_CLINIC", now: NOW }))
      .rejects.toMatchObject({ code: "POLICY" });
  });

  it("free bookings are staff-only", async () => {
    const hold = await holdFor();
    await expect(confirmAppointment(ctx.db, { holdId: hold.id, patient: PATIENT, paymentChoice: "FREE", now: NOW }))
      .rejects.toMatchObject({ code: "POLICY" });
    const ok = await confirmAppointment(ctx.db, { holdId: hold.id, patient: PATIENT, paymentChoice: "FREE", source: "STAFF", now: NOW });
    expect(ok.appointment.source).toBe("STAFF");
  });

  it("a hold cannot be used twice", async () => {
    const hold = await holdFor();
    await confirmAppointment(ctx.db, { holdId: hold.id, patient: PATIENT, paymentChoice: "AT_CLINIC", now: NOW });
    await expect(confirmAppointment(ctx.db, { holdId: hold.id, patient: PATIENT, paymentChoice: "AT_CLINIC", now: NOW }))
      .rejects.toMatchObject({ code: "HOLD_USED" });
  });

  it("hold expired but slot still free: re-locks and confirms (BK-23)", async () => {
    const hold = await holdFor();
    const later = new Date(NOW.getTime() + 15 * 60_000);
    const { appointment } = await confirmAppointment(ctx.db, {
      holdId: hold.id, patient: PATIENT, paymentChoice: "AT_CLINIC", now: later,
    });
    expect(appointment.status).toBe("CONFIRMED");
  });

  it("hold expired and someone else took the slot: SlotTakenError, nothing saved", async () => {
    const hold = await holdFor();
    const later = new Date(NOW.getTime() + 15 * 60_000);
    const svc = ctx.svc("gp-consultation");
    const other = await createHold(ctx.db, { serviceId: svc.id, doctorId: ctx.doctorId, startAt: at("09:00"), now: later });
    await confirmAppointment(ctx.db, { holdId: other.id, patient: { ...PATIENT, firstName: "Sean", dob: "1985-01-01" }, paymentChoice: "AT_CLINIC", now: later });

    await expect(confirmAppointment(ctx.db, { holdId: hold.id, patient: PATIENT, paymentChoice: "AT_CLINIC", now: later }))
      .rejects.toBeInstanceOf(SlotTakenError);
    expect(await ctx.db.select().from(schema.appointments)).toHaveLength(1); // rolled back
  });

  it("the same person booking twice creates one patient", async () => {
    const h1 = await holdFor("gp-consultation", "09:00");
    const h2 = await holdFor("gp-consultation", "09:15");
    await confirmAppointment(ctx.db, { holdId: h1.id, patient: PATIENT, paymentChoice: "AT_CLINIC", now: NOW });
    await confirmAppointment(ctx.db, { holdId: h2.id, patient: { ...PATIENT, email: "aoife@example.com" }, paymentChoice: "AT_CLINIC", now: NOW });
    expect(await ctx.db.select().from(schema.patients)).toHaveLength(1);
  });

  it("validates patient input", async () => {
    const hold = await holdFor();
    await expect(confirmAppointment(ctx.db, { holdId: hold.id, patient: { ...PATIENT, email: "nope" }, paymentChoice: "AT_CLINIC", now: NOW }))
      .rejects.toThrow();
  });
});

describe("cancel and reschedule", () => {
  const book = async (hhmm = "09:00") => {
    const svc = ctx.svc("gp-consultation");
    const hold = await createHold(ctx.db, { serviceId: svc.id, doctorId: ctx.doctorId, startAt: at(hhmm), now: NOW });
    const { appointment } = await confirmAppointment(ctx.db, {
      holdId: hold.id, patient: PATIENT, paymentChoice: "ONLINE", now: NOW,
      payment: { stripePaymentIntentId: `pi_${hhmm}`, method: "CARD" },
    });
    return { svc, appointment };
  };

  it("patient cancels outside the window: slot freed, refund due, event written", async () => {
    const { svc, appointment } = await book();
    const r = await cancelAppointment(ctx.db, { appointmentId: appointment.id, by: "PATIENT", now: NOW });
    expect(r.appointment.status).toBe("CANCELLED_BY_PATIENT");
    expect(r.refundDue).toBe(true);
    expect(await startTimes(svc.id)).toContain("09:00");
    const events = await ctx.db.select().from(schema.domainEvents);
    expect(events.map((e) => e.type)).toContain("appointment.cancelled");
  });

  it("patient is blocked inside the 24 hour window, clinic is not", async () => {
    const { appointment } = await book();
    const closeToStart = dublinToUtc("2026-11-23 15:00"); // 18 hours before
    await expect(cancelAppointment(ctx.db, { appointmentId: appointment.id, by: "PATIENT", now: closeToStart }))
      .rejects.toMatchObject({ code: "POLICY" });
    const r = await cancelAppointment(ctx.db, { appointmentId: appointment.id, by: "CLINIC", now: closeToStart });
    expect(r.appointment.status).toBe("CANCELLED_BY_CLINIC");
    expect(r.refundDue).toBe(true);
  });

  it("cannot cancel twice", async () => {
    const { appointment } = await book();
    await cancelAppointment(ctx.db, { appointmentId: appointment.id, by: "PATIENT", now: NOW });
    await expect(cancelAppointment(ctx.db, { appointmentId: appointment.id, by: "PATIENT", now: NOW }))
      .rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("reschedules: new slot taken, old slot freed, count increments", async () => {
    const { svc, appointment } = await book("09:00");
    const moved = await rescheduleAppointment(ctx.db, { appointmentId: appointment.id, newStartAt: at("11:00"), by: "PATIENT", now: NOW });
    expect(moved.startAt.toISOString()).toBe(at("11:00").toISOString());
    expect(moved.rescheduleCount).toBe(1);
    const t = await startTimes(svc.id);
    expect(t).toContain("09:00");
    expect(t).not.toContain("11:00");
  });

  it("can move to an overlapping time of its own old slot", async () => {
    const { appointment } = await book("09:00");
    const moved = await rescheduleAppointment(ctx.db, { appointmentId: appointment.id, newStartAt: at("09:15"), by: "PATIENT", now: NOW });
    expect(moved.startAt.toISOString()).toBe(at("09:15").toISOString());
  });

  it("cannot reschedule onto someone else's slot", async () => {
    const { appointment } = await book("09:00");
    await book("10:00");
    await expect(rescheduleAppointment(ctx.db, { appointmentId: appointment.id, newStartAt: at("10:00"), by: "PATIENT", now: NOW }))
      .rejects.toBeInstanceOf(SlotTakenError);
  });

  it("enforces the maximum number of patient reschedules", async () => {
    const { appointment } = await book("09:00");
    await rescheduleAppointment(ctx.db, { appointmentId: appointment.id, newStartAt: at("11:00"), by: "PATIENT", now: NOW });
    await rescheduleAppointment(ctx.db, { appointmentId: appointment.id, newStartAt: at("11:30"), by: "PATIENT", now: NOW });
    await expect(rescheduleAppointment(ctx.db, { appointmentId: appointment.id, newStartAt: at("12:00"), by: "PATIENT", now: NOW }))
      .rejects.toMatchObject({ code: "POLICY" });
    // Staff are not limited and do not use up the patient's allowance
    const moved = await rescheduleAppointment(ctx.db, { appointmentId: appointment.id, newStartAt: at("12:00"), by: "CLINIC", now: NOW });
    expect(moved.rescheduleCount).toBe(2);
  });
});

describe("helpers", () => {
  it("booking refs are unique-looking and well formed", () => {
    const refs = new Set(Array.from({ length: 200 }, generateBookingRef));
    expect(refs.size).toBe(200);
    for (const r of refs) expect(r).toMatch(/^RMC-[A-HJ-NP-Z2-9]{6}$/);
  });

  it("findOrCreatePatient keeps family members with a shared email apart", async () => {
    const a = await findOrCreatePatient(ctx.db, PATIENT);
    const b = await findOrCreatePatient(ctx.db, { ...PATIENT, firstName: "Liam", dob: "2015-06-01" });
    expect(a.id).not.toBe(b.id);
  });

  it("BookingError carries a code", () => {
    expect(new BookingError("POLICY", "x").code).toBe("POLICY");
  });
});
