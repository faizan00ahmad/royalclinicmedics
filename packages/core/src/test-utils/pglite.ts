import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { schema } from "@rmc/db";
import { drizzle } from "drizzle-orm/pglite";

const MIGRATIONS = join(__dirname, "..", "..", "..", "db", "migrations");

/** Fresh in-memory Postgres with every migration applied. Tests only. */
export async function createTestDb() {
  const client = new PGlite({ extensions: { btree_gist } });
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) if (stmt.trim()) await client.exec(stmt);
  }
  return { client, db: drizzle(client, { schema }) };
}
