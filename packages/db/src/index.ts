import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export * from "./schema";
export { schema };

let pool: Pool | undefined;

/** Fails clearly if DATABASE_URL is missing (CLAUDE.md: no silent mocks). */
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  pool ??= new Pool({ connectionString: url, max: 5 });
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof getDb>;
