import { schema } from "@rmc/db";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seed } from "@rmc/core/src/seed/seed";
import { MemoryTransport } from "@rmc/core";
import { FakeGateway, succeededEvent } from "@rmc/core/src/test-utils/fake-gateway";
import { createTestDb } from "@rmc/core/src/test-utils/pglite";
import { __resetRateLimits } from "@/lib/http";
import { __setServices } from "@/lib/server";
import { GET as slotsGET } from "./slots/route";
import { POST as holdPOST } from "./bookings/hold/route";
import { POST as checkoutPOST } from "./bookings/checkout/route";
import { GET as bookingGET } from "./bookings/[ref]/route";
import { POST as cancelPOST } from "./bookings/[ref]/cancel/route";
import { POST as reschedulePOST } from "./bookings/[ref]/reschedule/route";
import { GET as icsGET } from "./bookings/[ref]/ics/route";
import { POST as webhookPOST } from "./webhooks/stripe/route";
import { POST as cronPOST } from "./cron/[job]/route";

type Ctx = Awaited<ReturnType<typeof createTestDb>> & { serviceId: string; gw: FakeGateway; mail: MemoryTransport };
let ctx: Ctx;

beforeEach(async () => {
  __resetRateLimits();
  const t = await createTestDb();
  await seed(t.db);
  const [svc] = await t.db.select().from(schema.services).where(eq(schema.services.slug, "gp-consultation"));
  const gw = new FakeGateway();
  const mail = new MemoryTransport();
  ctx = { ...t, serviceId: svc!.id, gw, mail };
  __setServices({ db: () => t.db, gateway: () => gw, email: () => mail });
});

const url = (path: string, qs?: Record<string, string>) =>
  `http://localhost${path}${qs ? `?${new URLSearchParams(qs)}` : ""}`;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url(path), { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const refCtx = (ref: string) => ({ params: Promise.resolve({ ref }) });

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

/** First free slot at least 3 days away, so cancellation and reschedule policy are not triggered. */
async function firstSlot() {
  const res = await slotsGET(new Request(url("/api/slots", { serviceId: ctx.serviceId, from: iso(3), to: iso(14) })), undefined);
  const data = await res.json();
  return { res, data, slot: data.slots[0] as { doctorId: string; startAt: string; endAt: string } };
}

const PATIENT = { firstName: "Aoife", lastName: "Murphy", dob: "1990-04-12", email: "aoife@example.com", phone: "+353871234567" };
const QUESTIONNAIRE = { symptoms: "SECRET-SYMPTOM", allergies: { has: false }, smoker: false };
const CONSENTS = { terms: true, privacy: true, cancellation: true };

async function holdFirst(offset = 0) {
  const { data } = await firstSlot();
  const slot = data.slots[offset];
  const res = await holdPOST(post("/api/bookings/hold", { serviceId: ctx.serviceId, startAt: slot.startAt }), undefined);
  return { res, hold: await res.json(), slot };
}

async function bookAtClinic() {
  const { hold } = await holdFirst();
  const res = await checkoutPOST(post("/api/bookings/checkout", {
    holdId: hold.holdId, patient: PATIENT, paymentChoice: "AT_CLINIC", reason: "SECRET-REASON",
    questionnaire: QUESTIONNAIRE, consents: CONSENTS,
  }), undefined);
  return { res, body: await res.json(), hold };
}

describe("GET /api/slots", () => {
  it("returns free slots and days", async () => {
    const { res, data } = await firstSlot();
    expect(res.status).toBe(200);
    expect(data.slots.length).toBeGreaterThan(10);
    expect(data.days.length).toBeGreaterThan(1);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects bad parameters with 400 and no echoed values", async () => {
    const res = await slotsGET(new Request(url("/api/slots", { serviceId: "nope", from: "2026-01-01", to: "2026-01-01" })), undefined);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("nope");
  });
  it("limits the date range", async () => {
    const res = await slotsGET(new Request(url("/api/slots", { serviceId: ctx.serviceId, from: iso(0), to: iso(120) })), undefined);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/bookings/hold", () => {
  it("holds a slot (any doctor) and removes it from availability", async () => {
    const { res, hold, slot } = await holdFirst();
    expect(res.status).toBe(201);
    expect(hold.holdId).toBeTruthy();
    const { data } = await firstSlot();
    expect(data.slots.map((s: { startAt: string }) => s.startAt)).not.toContain(slot.startAt);
  });
  it("second hold on the same time is 409", async () => {
    const { slot } = await holdFirst();
    const res = await holdPOST(post("/api/bookings/hold", { serviceId: ctx.serviceId, startAt: slot.startAt }), undefined);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("SLOT_TAKEN");
  });
  it("is rate limited per IP", async () => {
    const { slot } = await firstSlot();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await holdPOST(post("/api/bookings/hold", { serviceId: ctx.serviceId, startAt: slot.startAt }, { "x-forwarded-for": "9.9.9.9" }), undefined);
      statuses.push(r.status);
    }
    expect(statuses).toContain(429);
    expect(statuses.slice(0, 10)).not.toContain(429);
  });
  it("rejects malformed JSON", async () => {
    const res = await holdPOST(new Request(url("/api/bookings/hold"), { method: "POST", body: "{nope" }), undefined);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/bookings/checkout", () => {
  it("pay at clinic: confirms and returns a reference and token, without echoing patient data", async () => {
    const { res, body } = await bookAtClinic();
    expect(res.status).toBe(201);
    expect(body.status).toBe("CONFIRMED");
    expect(body.bookingRef).toMatch(/^RMC-/);
    expect(body.manageToken.length).toBeGreaterThan(20);
    const text = JSON.stringify(body);
    for (const secret of ["SECRET-SYMPTOM", "SECRET-REASON", "aoife@example.com", "Murphy"]) expect(text).not.toContain(secret);
    const consents = await ctx.db.select().from(schema.consents);
    expect(consents.map((c) => c.type).sort()).toEqual(["CANCELLATION", "PRIVACY", "TERMS"]);
  });

  it("requires all three consents", async () => {
    const { hold } = await holdFirst();
    const res = await checkoutPOST(post("/api/bookings/checkout", {
      holdId: hold.holdId, patient: PATIENT, paymentChoice: "AT_CLINIC", questionnaire: QUESTIONNAIRE,
      consents: { ...CONSENTS, privacy: false },
    }), undefined);
    expect(res.status).toBe(400);
    expect(await ctx.db.select().from(schema.appointments)).toHaveLength(0);
  });

  it("validates the questionnaire", async () => {
    const { hold } = await holdFirst();
    const res = await checkoutPOST(post("/api/bookings/checkout", {
      holdId: hold.holdId, patient: PATIENT, paymentChoice: "AT_CLINIC", questionnaire: { smoker: "maybe" }, consents: CONSENTS,
    }), undefined);
    expect(res.status).toBe(400);
  });

  it("online: returns a client secret and a pending booking; the webhook then confirms it", async () => {
    const { hold } = await holdFirst();
    const res = await checkoutPOST(post("/api/bookings/checkout", {
      holdId: hold.holdId, patient: PATIENT, paymentChoice: "ONLINE", questionnaire: QUESTIONNAIRE, consents: CONSENTS,
    }), undefined);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.status).toBe("PENDING_PAYMENT");
    expect(body.clientSecret).toMatch(/_secret$/);
    expect(JSON.stringify(ctx.gw.intents)).not.toContain("SECRET-SYMPTOM");

    const piId = ctx.gw.intents[0]!.id;
    const hookRes = await webhookPOST(
      new Request(url("/api/webhooks/stripe"), { method: "POST", headers: { "stripe-signature": "valid" }, body: JSON.stringify(succeededEvent("evt_1", piId, body.amountCents)) }),
      undefined,
    );
    expect(hookRes.status).toBe(200);
    expect((await hookRes.json()).outcome).toBe("CONFIRMED");

    const got = await bookingGET(new Request(url(`/api/bookings/${body.bookingRef}`), { headers: { "x-manage-token": body.manageToken } }), refCtx(body.bookingRef));
    expect((await got.json()).status).toBe("CONFIRMED");
  });

  it("a stale hold id is refused", async () => {
    const res = await checkoutPOST(post("/api/bookings/checkout", {
      holdId: "00000000-0000-4000-8000-000000000000", patient: PATIENT, paymentChoice: "AT_CLINIC", questionnaire: QUESTIONNAIRE, consents: CONSENTS,
    }), undefined);
    expect(res.status).toBe(404);
  });
});

describe("manage a booking", () => {
  it("needs the token: wrong token and wrong ref are both 404", async () => {
    const { body } = await bookAtClinic();
    const bad = await bookingGET(new Request(url(`/api/bookings/${body.bookingRef}`), { headers: { "x-manage-token": "x".repeat(43) } }), refCtx(body.bookingRef));
    expect(bad.status).toBe(404);
    const none = await bookingGET(new Request(url(`/api/bookings/${body.bookingRef}`)), refCtx(body.bookingRef));
    expect(none.status).toBe(404);
    const wrongRef = await bookingGET(new Request(url("/api/bookings/RMC-AAAAAA"), { headers: { "x-manage-token": body.manageToken } }), refCtx("RMC-AAAAAA"));
    expect(wrongRef.status).toBe(404);
    expect(await bad.text()).toBe(await wrongRef.text());
  });

  it("summary holds no health or contact data", async () => {
    const { body } = await bookAtClinic();
    const res = await bookingGET(new Request(url(`/api/bookings/${body.bookingRef}`), { headers: { "x-manage-token": body.manageToken } }), refCtx(body.bookingRef));
    const text = JSON.stringify(await res.json());
    for (const secret of ["SECRET-SYMPTOM", "SECRET-REASON", "aoife@example.com", "+353871234567"]) expect(text).not.toContain(secret);
  });

  it("cancels and frees the slot", async () => {
    const { body, hold } = await bookAtClinic();
    const res = await cancelPOST(new Request(url(`/api/bookings/${body.bookingRef}/cancel`), { method: "POST", headers: { "x-manage-token": body.manageToken } }), refCtx(body.bookingRef));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("CANCELLED_BY_PATIENT");
    const again = await holdPOST(post("/api/bookings/hold", { serviceId: ctx.serviceId, startAt: hold.startAt }), undefined);
    expect(again.status).toBe(201);
  });

  it("cancel with a wrong token is 404 and changes nothing", async () => {
    const { body } = await bookAtClinic();
    const res = await cancelPOST(new Request(url(`/api/bookings/${body.bookingRef}/cancel`), { method: "POST", headers: { "x-manage-token": "y".repeat(43) } }), refCtx(body.bookingRef));
    expect(res.status).toBe(404);
    const [a] = await ctx.db.select().from(schema.appointments);
    expect(a!.status).toBe("CONFIRMED");
  });

  it("reschedules to another free time", async () => {
    const { body } = await bookAtClinic();
    const { data } = await firstSlot();
    const target = data.slots[5].startAt as string;
    const res = await reschedulePOST(post(`/api/bookings/${body.bookingRef}/reschedule`, { newStartAt: target }, { "x-manage-token": body.manageToken }), refCtx(body.bookingRef));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.startAt).toBe(target);
    expect(json.rescheduleCount).toBe(1);
  });

  it("downloads a calendar file with the token in the query and no health data", async () => {
    const { body } = await bookAtClinic();
    const res = await icsGET(new Request(url(`/api/bookings/${body.bookingRef}/ics`, { token: body.manageToken })), refCtx(body.bookingRef));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    const ics = await res.text();
    expect(ics).toContain(`UID:${body.bookingRef}@`);
    expect(ics).not.toContain("SECRET");
    const noToken = await icsGET(new Request(url(`/api/bookings/${body.bookingRef}/ics`)), refCtx(body.bookingRef));
    expect(noToken.status).toBe(404);
  });
});

describe("POST /api/webhooks/stripe", () => {
  it("rejects a bad or missing signature", async () => {
    const bad = await webhookPOST(new Request(url("/api/webhooks/stripe"), { method: "POST", headers: { "stripe-signature": "forged" }, body: "{}" }), undefined);
    expect(bad.status).toBe(400);
    const none = await webhookPOST(new Request(url("/api/webhooks/stripe"), { method: "POST", body: "{}" }), undefined);
    expect(none.status).toBe(400);
  });
});

describe("POST /api/cron/[job]", () => {
  const call = (job: string, auth?: string) =>
    cronPOST(new Request(url(`/api/cron/${job}`), { method: "POST", headers: auth ? { authorization: auth } : {} }), { params: Promise.resolve({ job }) });

  it("is 503 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("maintenance", "Bearer anything")).status).toBe(503);
  });
  it("rejects missing or wrong secrets and accepts the right one", async () => {
    process.env.CRON_SECRET = "s3cret-value-for-tests";
    expect((await call("maintenance")).status).toBe(401);
    expect((await call("maintenance", "Bearer wrong")).status).toBe(401);
    const ok = await call("maintenance", "Bearer s3cret-value-for-tests");
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);
    expect((await call("nope", "Bearer s3cret-value-for-tests")).status).toBe(404);
  });
  it("cancels abandoned online checkouts", async () => {
    process.env.CRON_SECRET = "s3cret-value-for-tests";
    const { hold } = await holdFirst();
    await checkoutPOST(post("/api/bookings/checkout", {
      holdId: hold.holdId, patient: PATIENT, paymentChoice: "ONLINE", questionnaire: QUESTIONNAIRE, consents: CONSENTS,
    }), undefined);
    // age the hold past expiry plus the 30 minute grace period
    await ctx.client.exec(`UPDATE core.slot_holds SET expires_at = now() - interval '2 hours'`);
    const res = await call("maintenance", "Bearer s3cret-value-for-tests");
    expect((await res.json()).expiredUnpaid).toBe(1);
  });
});

describe("emails sent by the routes", () => {
  it("a pay-at-clinic booking emails the patient a confirmation with a working manage link, and no health data", async () => {
    const { body } = await bookAtClinic();
    await vi.waitFor(() => expect(ctx.mail.sent.some((m) => m.to === "aoife@example.com")).toBe(true), { timeout: 8000 });
    const mail = ctx.mail.sent.find((m) => m.to === "aoife@example.com")!;
    expect(mail.subject).toContain(body.bookingRef);
    expect(mail.text).toContain(`#token=${body.manageToken}`); // the very link the page gave the patient
    expect(JSON.stringify(ctx.mail.sent)).not.toMatch(/SECRET-/);
  });

  it("cancelling by the manage link emails the patient", async () => {
    const { body } = await bookAtClinic();
    await vi.waitFor(() => expect(ctx.mail.sent.length).toBeGreaterThan(0), { timeout: 8000 });
    ctx.mail.sent.length = 0;
    await cancelPOST(new Request(url(`/api/bookings/${body.bookingRef}/cancel`), { method: "POST", headers: { "x-manage-token": body.manageToken } }), refCtx(body.bookingRef));
    await vi.waitFor(() => expect(ctx.mail.sent.some((m) => m.subject.includes("cancelled"))).toBe(true), { timeout: 8000 });
  });

  it("the cron job sends reminders and retries emails that failed earlier", async () => {
    process.env.CRON_SECRET = "s3cret-value-for-tests";
    ctx.mail.failNext = 1;
    await bookAtClinic();
    await new Promise((r) => setTimeout(r, 1500)); // let the first (failing) attempt finish
    const res = await cronPOST(new Request(url("/api/cron/maintenance"), { method: "POST", headers: { authorization: "Bearer s3cret-value-for-tests" } }), { params: Promise.resolve({ job: "maintenance" }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.emails + ctx.mail.sent.length).toBeGreaterThan(0);
    expect(ctx.mail.sent.some((m) => m.to === "aoife@example.com")).toBe(true);
  });
});
