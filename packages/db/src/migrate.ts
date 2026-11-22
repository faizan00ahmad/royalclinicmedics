import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The two methods this needs. Both node-postgres (Pool) and PGlite provide them. */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Applies the SQL files in `migrations/` that have not run yet, in order, and records each one.
 * Safe to run any number of times. Used for the production (Neon) database: `pnpm db:migrate`.
 * A file that fails stops the run, so the database is never left half way through a later file.
 */
export async function applyMigrations(client: SqlClient, dir: string, log: (msg: string) => void = () => {}): Promise<string[]> {
  await client.query(`CREATE TABLE IF NOT EXISTS public.__rmc_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await client.query(`SELECT name FROM public.__rmc_migrations`)).rows.map((r) => String(r.name)));
  const applied: string[] = [];

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    log(`Applying ${file}...`);
    await client.query("BEGIN");
    try {
      for (const stmt of readFileSync(join(dir, file), "utf8").split("--> statement-breakpoint")) {
        if (stmt.trim()) await client.query(stmt);
      }
      await client.query(`INSERT INTO public.__rmc_migrations (name) VALUES ($1)`, [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
    applied.push(file);
  }
  return applied;
}
