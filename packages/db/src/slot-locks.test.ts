import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { beforeAll, describe, expect, it } from "vitest";

const dir = join(__dirname, "..", "migrations");
let db: PGlite;

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  await db.exec("CREATE EXTENSION IF NOT EXISTS btree_gist;");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8").replace(/CREATE EXTENSION IF NOT EXISTS btree_gist;/g, "");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      if (stmt.trim()) await db.exec(stmt);
    }
  }
  await db.exec(`INSERT INTO core.doctors (id, display_name) VALUES
    ('00000000-0000-0000-0000-000000000001','Dr A'),
    ('00000000-0000-0000-0000-000000000002','Dr B');`);
  await db.exec(`INSERT INTO core.services (id, slug, name, price_cents, duration_min) VALUES
    ('00000000-0000-0000-0000-0000000000aa','gp','GP',5000,15);`);
  await db.exec(`INSERT INTO core.slot_holds (id, doctor_id, service_id, start_at, end_at, expires_at) VALUES
    ('00000000-0000-0000-0000-0000000000h1'::text::uuid, '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000aa','2026-11-24 10:00+00','2026-11-24 10:15+00', now());`
    .replace("'00000000-0000-0000-0000-0000000000h1'::text::uuid", "'00000000-0000-0000-0000-0000000000f1'"));
});

const lock = (doctor: string, start: string, end: string) =>
  db.exec(`INSERT INTO core.slot_locks (doctor_id, start_at, end_at, kind, hold_id, expires_at)
    VALUES ('${doctor}', '${start}', '${end}', 'HOLD', '00000000-0000-0000-0000-0000000000f1', now())`);

const A = "00000000-0000-0000-0000-000000000001";
const B = "00000000-0000-0000-0000-000000000002";

describe("slot_locks exclusion constraint", () => {
  it("accepts the first lock", async () => {
    await expect(lock(A, "2026-11-24 10:00+00", "2026-11-24 10:15+00")).resolves.toBeDefined();
  });
  it("rejects an overlapping lock for the same doctor", async () => {
    await expect(lock(A, "2026-11-24 10:10+00", "2026-11-24 10:25+00")).rejects.toThrow();
  });
  it("accepts a back-to-back lock (end is exclusive)", async () => {
    await expect(lock(A, "2026-11-24 10:15+00", "2026-11-24 10:30+00")).resolves.toBeDefined();
  });
  it("accepts the same time for a different doctor", async () => {
    await expect(lock(B, "2026-11-24 10:00+00", "2026-11-24 10:15+00")).resolves.toBeDefined();
  });
  it("creates the empty clinical schema", async () => {
    const r = await db.query("SELECT 1 FROM information_schema.schemata WHERE schema_name='clinical'");
    expect(r.rows.length).toBe(1);
  });
});
