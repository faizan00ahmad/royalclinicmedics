/**
 * Creates, migrates and seeds the LOCAL development database. No accounts or Docker needed.
 * Real Postgres (PGlite) with its data in `.devdb/`. Run `pnpm dev:db` once, and again whenever migrations change.
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

  await client.exec(`CREATE TABLE IF NOT EXISTS public.__rmc_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

  // Databases created by the first version of this script have no tracking table: record what they already have.
  const tracked = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.__rmc_migrations`);
  const hasCore = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name = 'core'`);
  if (!tracked.rows[0]?.n && hasCore.rows[0]?.n) {
    const hasHold = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='core' AND table_name='appointments' AND column_name='hold_id'`,
    );
    const already = ["0000_init.sql", "0001_guards.sql", ...(hasHold.rows[0]?.n ? ["0002_appointment_hold.sql"] : [])];
    for (const name of already) await client.query(`INSERT INTO public.__rmc_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING`, [name]);
  }

  const done = new Set((await client.query<{ name: string }>(`SELECT name FROM public.__rmc_migrations`)).rows.map((r) => r.name));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    console.log(`Applying ${f}...`);
    for (const stmt of readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await client.exec(stmt);
    }
    await client.query(`INSERT INTO public.__rmc_migrations (name) VALUES ($1)`, [f]);
  }

  await seed(drizzle(client, { schema }));

  await client.close();
  console.log("Dev database ready in " + DATA_DIR);
}

main().catch((err) => {
  console.error("Dev database failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
