import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  schemaFilter: ["core", "cms", "ops"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
