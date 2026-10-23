import "dotenv/config";

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * A logical, consistent snapshot of every application table.
 *
 * This exists because `pg_dump` is not always installed on the machine that has
 * the database credentials. It is not a replacement for a physical PostgreSQL
 * backup, but it preserves every row, including password hashes and session
 * hashes, and can be imported again. The file is written outside version
 * control under `backups/`.
 *
 * All reads happen in one repeatable-read transaction, so a live booking or
 * notification cannot land halfway through the snapshot.
 */

const MODELS = [
  "activationToken",
  "admin",
  "adminAccessRequest",
  "authSession",
  "booking",
  "bookingInventory",
  "bookingService",
  "bookingStaff",
  "businessSetting",
  "customer",
  "event",
  "inventory",
  "invoice",
  "loginAttempt",
  "notification",
  "otpChallenge",
  "package",
  "packageService",
  "payment",
  "paymentOrder",
  "paymentWebhookEvent",
  "role",
  "securityEvent",
  "service",
  "staff",
  "user",
];

const prisma = new PrismaClient();

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function databaseLocation() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set.");
  try {
    const url = new URL(raw);
    return { host: url.host, database: url.pathname.replace(/^\//, "") || "unknown" };
  } catch {
    return { host: "unparseable", database: "unknown" };
  }
}

async function main() {
  const snapshot = await prisma.$transaction(
    async (tx) => {
      const tables = {};
      for (const model of MODELS) {
        tables[model] = await tx[model].findMany();
      }
      // Prisma's own migration history is not exposed as a model. Keep it too,
      // so a restore can tell which migrations had already been applied.
      tables._prisma_migrations = await tx.$queryRawUnsafe(
        'SELECT * FROM "_prisma_migrations" ORDER BY started_at ASC',
      );
      return tables;
    },
    { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 120_000 },
  );

  const counts = Object.fromEntries(
    Object.entries(snapshot).map(([table, rows]) => [table, rows.length]),
  );
  const payload = {
    format: "event-management-json-snapshot-v1",
    exportedAt: new Date().toISOString(),
    database: databaseLocation(),
    counts,
    tables: snapshot,
  };
  const json = JSON.stringify(payload, (_key, value) => {
    if (typeof value === "bigint") return value.toString();
    return value;
  }, 2);

  const directory = path.resolve("backups");
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, `neondb-${timestamp()}.json`);
  await writeFile(filename, json, "utf8");

  const digest = createHash("sha256").update(json).digest("hex");
  console.log(`Backup written: ${filename}`);
  console.log(`SHA-256: ${digest}`);
  console.log(JSON.stringify(counts, null, 2));
}

main()
  .catch((error) => {
    console.error("Backup failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
