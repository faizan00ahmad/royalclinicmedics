import { schema } from "@rmc/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryTransport, saveSettings } from "@rmc/core";
import { createTestDb } from "@rmc/core/src/test-utils/pglite";
import { __resetRateLimits } from "@/lib/http";
import { __setServices } from "@/lib/server";
import { POST } from "./route";

let t: Awaited<ReturnType<typeof createTestDb>>;
let mail: MemoryTransport;

beforeEach(async () => {
  __resetRateLimits();
  t = await createTestDb();
  mail = new MemoryTransport();
  __setServices({ db: () => t.db, email: () => mail });
});

const send = (body: unknown, ip = "1.1.1.1") =>
  POST(new Request("http://localhost/api/contact", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body),
  }), undefined);

const valid = { name: "Aoife", email: "Aoife@Example.com", message: "Do you open on Saturdays?", consent: true };

describe("POST /api/contact", () => {
  it("saves a valid enquiry with a lower-cased email", async () => {
    expect((await send(valid)).status).toBe(201);
    const rows = await t.db.select().from(schema.enquiries);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe("aoife@example.com");
    expect(rows[0]!.status).toBe("NEW");
  });

  it("requires consent and a real message", async () => {
    expect((await send({ ...valid, consent: false })).status).toBe(400);
    expect((await send({ ...valid, message: "hi" })).status).toBe(400);
    expect(await t.db.select().from(schema.enquiries)).toHaveLength(0);
  });

  it("silently drops honeypot submissions (bots)", async () => {
    const res = await send({ ...valid, website: "http://spam.example" });
    expect(res.status).toBe(201);
    expect(await t.db.select().from(schema.enquiries)).toHaveLength(0);
  });

  it("is rate limited", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await send(valid, "2.2.2.2")).status);
    expect(statuses).toContain(429);
  });

  it("emails the clinic and sends the sender an automatic reply", async () => {
    await saveSettings(t.db, { "clinic.email": "reception@clinic.example" }, { id: "00000000-0000-4000-8000-000000000001", role: "ADMIN" });
    await send(valid);
    await vi.waitFor(() => expect(mail.sent).toHaveLength(2), { timeout: 8000 });
    expect(mail.sent.map((m) => m.to).sort()).toEqual(["aoife@example.com", "reception@clinic.example"]);
    expect(mail.sent.find((m) => m.to === "reception@clinic.example")!.replyTo).toBe("aoife@example.com");
  });

  it("a bot's honeypot submission sends nothing", async () => {
    await send({ ...valid, website: "http://spam.example" });
    await new Promise((r) => setTimeout(r, 500));
    expect(mail.sent).toHaveLength(0);
  });
});
