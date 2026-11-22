/**
 * Creates and seeds the LOCAL development database. No accounts or Docker needed.
 * Real Postgres (PGlite) with its data in `.devdb/`. Run `pnpm dev:db` once, then again whenever migrations change.
 * The website opens the same folder itself (DATABASE_URL=pglite:...), so this script must not be running while you use the site.
 * Development only. Production uses Neon.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { schema } from "@rmc/db";
import { drizzle } from "drizzle-orm/pglite";
import { seed } from "../seed/seed";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const DATA_DIR = join(ROOT, ".devdb");
const MIGRATIONS = join(ROOT, "packages", "db", "migrations");

async function main() {
  const client = new PGlite({ dataDir: DATA_DIR, extensions: { btree_gist } });
  await client.waitReady;

  const has = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name = 'core'`,
  );
  if (!has.rows[0]?.n) {
    console.log("Creating tables...");
    for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
      for (const stmt of readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint")) {
        if (stmt.trim()) await client.exec(stmt);
      }
    }
  } else {
    // Apply migrations added after the first run (they are additive and written to be applied once, in order).
    const done = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='core' AND table_name='appointments' AND column_name='hold_id'`,
    );
    if (!done.rows[0]?.n) {
      console.log("Applying newer migrations...");
      for (const stmt of readFileSync(join(MIGRATIONS, "0002_appointment_hold.sql"), "utf8").split("--> statement-breakpoint")) {
        if (stmt.trim()) await client.exec(stmt);
      }
    }
  }

  await seed(drizzle(client, { schema }));

  await client.close();
  console.log("Dev database ready in " + DATA_DIR);
  console.log("DATABASE_URL=pglite:" + DATA_DIR.split("\\").join("/"));
}

main().catch((err) => {
  console.error("Dev database failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
