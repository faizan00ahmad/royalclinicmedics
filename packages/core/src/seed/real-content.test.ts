import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../test-utils/pglite";
import { applyRealContent } from "./real-content";
import { seed } from "./seed";

let client: Awaited<ReturnType<typeof createTestDb>>["client"];
let db: Awaited<ReturnType<typeof createTestDb>>["db"];

beforeAll(async () => {
  ({ client, db } = await createTestDb());
  await seed(db);
});

const one = async <T>(sql: string) => (await client.query<T>(sql)).rows;

describe("real clinic content", () => {
  it("loads the real details, services, hours and FAQs", async () => {
    expect(await applyRealContent(db)).toBe("applied");
    expect((await one<{ n: number }>(`SELECT count(*)::int n FROM core.services WHERE active`))[0]!.n).toBe(5);
    const names = (await one<{ name: string }>(`SELECT name FROM core.services WHERE active ORDER BY sort_order`)).map((r) => r.name);
    expect(names).toEqual(["GP Consultation", "Phone Consultation", "Urgent Care", "Blood Collection", "Sick Certificate"]);
    expect((await one<{ price_cents: number }>(`SELECT price_cents FROM core.services WHERE slug='blood-collection'`))[0]!.price_cents).toBe(3000);
    expect((await one<{ n: number }>(`SELECT count(*)::int n FROM core.availability_rules`))[0]!.n).toBe(6);
    expect((await one<{ n: number }>(`SELECT count(*)::int n FROM cms.faqs`))[0]!.n).toBe(8);
    expect((await one<{ value: string }>(`SELECT value FROM ops.settings WHERE key='clinic.phone'`))[0]!.value).toBe("051 876531");
    // each real service can be booked with the doctor
    expect((await one<{ n: number }>(`SELECT count(*)::int n FROM core.service_doctors sd JOIN core.services s ON s.id=sd.service_id WHERE s.active`))[0]!.n).toBe(5);
  });

  it("hides the placeholder services without deleting them", async () => {
    expect((await one<{ n: number }>(`SELECT count(*)::int n FROM core.services WHERE NOT active`))[0]!.n).toBe(7);
  });

  it("does not overwrite admin edits on a second run, unless forced", async () => {
    await client.exec(`UPDATE core.services SET price_cents = 9999 WHERE slug='gp-consultation'`);
    expect(await applyRealContent(db)).toBe("skipped");
    expect((await one<{ price_cents: number }>(`SELECT price_cents FROM core.services WHERE slug='gp-consultation'`))[0]!.price_cents).toBe(9999);
    expect(await applyRealContent(db, { force: true })).toBe("applied");
    expect((await one<{ price_cents: number }>(`SELECT price_cents FROM core.services WHERE slug='gp-consultation'`))[0]!.price_cents).toBe(6000);
  });
});
