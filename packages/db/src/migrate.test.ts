import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

const REAL = join(__dirname, "..", "migrations");

describe("applyMigrations (used for the production database)", () => {
  it("applies every real migration to an empty database, then does nothing the second time", async () => {
    const db = new PGlite({ extensions: { btree_gist } });
    const first = await applyMigrations(db, REAL);
    expect(first.length).toBeGreaterThanOrEqual(4);
    expect(first[0]).toBe("0000_init.sql");
    expect(await applyMigrations(db, REAL)).toEqual([]);
    const t = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_schema in ('core','cms','ops')`);
    expect(t.rows[0]!.n).toBeGreaterThan(20);
  });

  it("only applies files that are new", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    writeFileSync(join(dir, "0000_a.sql"), "CREATE TABLE a (id int);");
    const db = new PGlite();
    expect(await applyMigrations(db, dir)).toEqual(["0000_a.sql"]);
    writeFileSync(join(dir, "0001_b.sql"), "CREATE TABLE b (id int);");
    expect(await applyMigrations(db, dir)).toEqual(["0001_b.sql"]);
  });

  it("rolls a failing file back completely and stops", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    writeFileSync(join(dir, "0000_ok.sql"), "CREATE TABLE ok (id int);");
    writeFileSync(join(dir, "0001_bad.sql"), "CREATE TABLE half (id int);\n--> statement-breakpoint\nTHIS IS NOT SQL;");
    writeFileSync(join(dir, "0002_later.sql"), "CREATE TABLE later (id int);");
    const db = new PGlite();
    await expect(applyMigrations(db, dir)).rejects.toThrow();
    const tables = (await db.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema='public'`)).rows.map((r) => r.table_name);
    expect(tables).toContain("ok");
    expect(tables).not.toContain("half"); // rolled back
    expect(tables).not.toContain("later"); // never reached
  });
});
