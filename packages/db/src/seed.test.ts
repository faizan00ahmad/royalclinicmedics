import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "./schema";
import { seed } from "./seed";

const dir = join(__dirname, "..", "migrations");
let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite({ extensions: { btree_gist } });
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) if (stmt.trim()) await client.exec(stmt);
  }
  db = drizzle(client, { schema });
});

const count = async (table: string) =>
  (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;

describe("seed", () => {
  it("creates the expected rows", async () => {
    await seed(db);
    expect(await count("core.doctors")).toBe(1);
    expect(await count("core.services")).toBe(8);
    expect(await count("core.service_doctors")).toBe(8);
    expect(await count("core.availability_rules")).toBe(10);
    expect(await count("core.clinic_holidays")).toBe(20);
    expect(await count("cms.faqs")).toBe(6);
    expect(await count("cms.pages")).toBe(4);
    expect(await count("ops.settings")).toBeGreaterThan(15);
  });

  it("is idempotent and keeps admin edits", async () => {
    await client.exec(`UPDATE core.services SET price_cents = 9999 WHERE slug = 'gp-consultation'`);
    await seed(db);
    await seed(db);
    expect(await count("core.doctors")).toBe(1);
    expect(await count("core.services")).toBe(8);
    expect(await count("core.clinic_holidays")).toBe(20);
    expect(await count("cms.faqs")).toBe(6);
    const r = await client.query<{ price_cents: number }>(`SELECT price_cents FROM core.services WHERE slug='gp-consultation'`);
    expect(r.rows[0]!.price_cents).toBe(9999);
  });

  it("keeps online consultations and reviews off by default", async () => {
    const r = await client.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM ops.settings WHERE key IN ('features.onlineConsultations','features.googleReviews')`);
    expect(r.rows.every((x) => x.value === false)).toBe(true);
  });
});
