import type { schema } from "@rmc/db";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/** Works for both a Drizzle database and a transaction (node-postgres, PGlite in tests). */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
