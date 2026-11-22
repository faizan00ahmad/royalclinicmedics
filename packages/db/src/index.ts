import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export * from "./schema";
export { schema };

let pool: Pool | undefined;

type AppDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * LOCAL DEVELOPMENT ONLY. `DATABASE_URL=pglite:<folder>` runs a real Postgres (PGlite) inside the app process
 * with its data in that folder. Created and seeded by `pnpm dev:db`. Refused in production.
 */
function getPglite(dataDir: string): AppDb {
  if (process.env.NODE_ENV === "production") throw new Error("pglite: URLs are for local development only");
  const g = globalThis as { __rmcPglite?: AppDb };
  if (!g.__rmcPglite) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { PGlite } = require("@electric-sql/pglite");
    const { btree_gist } = require("@electric-sql/pglite/contrib/btree_gist");
    const { drizzle: drizzlePglite } = require("drizzle-orm/pglite");
    g.__rmcPglite = drizzlePglite(new PGlite({ dataDir, extensions: { btree_gist } }), { schema }) as AppDb;
  }
  return g.__rmcPglite;
}

/** Fails clearly if DATABASE_URL is missing (CLAUDE.md: no silent mocks). */
export function getDb(): AppDb {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (url.startsWith("pglite:")) return getPglite(url.slice("pglite:".length));
  pool ??= new Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 5) });
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof getDb>;
