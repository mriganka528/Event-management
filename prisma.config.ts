import "dotenv/config";
import { defineConfig } from "prisma/config";
import { migrationDatabaseUrl } from "./lib/database-url.mjs";

/*
 * Prisma CLI commands use a direct connection when the provider exposes one.
 *
 * The application itself keeps using DATABASE_URL (a pooled Neon/PgBouncer
 * connection) at runtime. `prisma migrate deploy` cannot reliably use that
 * connection: it takes a session-level advisory lock, and a transaction-mode
 * pooler may time it out with P1002. See `lib/database-url.mjs`.
 */
const databaseUrl = migrationDatabaseUrl();

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for Prisma commands. Set DATABASE_URL in this shell or in .env.",
  );
}

export default defineConfig({
  engine: "classic",
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
