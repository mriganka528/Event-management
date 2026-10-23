import { PrismaClient } from "@prisma/client";

import { pooledDatabaseUrl } from "./prisma-pool.mjs";

/**
 * Connections this client is allowed to hold open.
 *
 * Deliberately far below Prisma's default of `num_cpus * 2 + 1`. The database is
 * behind Neon's pooler, which exists to multiplex connections, so a large pool in
 * front of it only causes contention — see `lib/prisma-pool.mjs`.
 *
 * `server.mjs` runs a second, much quieter client for Socket.IO, so the ceiling
 * here has to leave room for it.
 */
const CONNECTION_LIMIT = 5;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Every page render, layout, and server action routes its queries through
    // here, so this is the pool that matters.
    datasourceUrl: pooledDatabaseUrl(process.env.DATABASE_URL, CONNECTION_LIMIT),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

