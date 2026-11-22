import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { applyMigrations } from "./migrate";

const url = process.env.DATABASE_URL;
if (!url || url.startsWith("pglite:")) {
  console.error("Set DATABASE_URL to the real (Neon) connection string. For the local test database use: pnpm dev:db");
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 1 });
applyMigrations(pool, join(dirname(fileURLToPath(import.meta.url)), "..", "migrations"), console.log)
  .then((applied) => { console.log(applied.length ? `Done. Applied ${applied.length} file(s).` : "Database is already up to date."); })
  .catch((err) => { console.error("Migration failed:", err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => pool.end());
