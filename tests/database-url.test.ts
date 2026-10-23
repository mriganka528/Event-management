import assert from "node:assert/strict";
import test from "node:test";

import { migrationDatabaseUrl } from "../lib/database-url.mjs";

/**
 * Prisma migrations take a session-level advisory lock. A transaction-mode
 * pooler can time that lock out (P1002), so the CLI must use a direct host while
 * the application keeps using the pooled one.
 */

const NEON_POOLER =
  "postgresql://user:pass@ep-old-rain-aeozcg0n-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const NEON_DIRECT =
  "postgresql://user:pass@ep-old-rain-aeozcg0n.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

test("Neon's pooled host is rewritten to its direct twin", () => {
  const result = migrationDatabaseUrl({ DATABASE_URL: NEON_POOLER });
  assert.equal(result, NEON_DIRECT);
});

test("pooler-only query parameters are removed from the migration URL", () => {
  const result = new URL(
    migrationDatabaseUrl({ DATABASE_URL: `${NEON_POOLER}&pgbouncer=true` }) as string,
  );
  assert.equal(result.searchParams.has("pgbouncer"), false);
  assert.equal(result.searchParams.get("sslmode"), "require");
  assert.equal(result.searchParams.get("channel_binding"), "require");
});

test("an explicit direct URL always wins", () => {
  for (const name of ["DIRECT_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"] as const) {
    assert.equal(
      migrationDatabaseUrl({
        DATABASE_URL: NEON_POOLER,
        [name]: "postgresql://direct.example.com/neondb",
      }),
      "postgresql://direct.example.com/neondb",
      `${name} should take precedence over DATABASE_URL`,
    );
  }
});

test("a direct DATABASE_URL is left alone", () => {
  assert.equal(migrationDatabaseUrl({ DATABASE_URL: NEON_DIRECT }), NEON_DIRECT);
});

test("an unfamiliar pooler is not guessed at", () => {
  // Supabase's direct host is not derivable by renaming the pooler host, so it
  // must be supplied through DIRECT_URL instead of being rewritten wrongly.
  const supabase =
    "postgresql://postgres.project:pass@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";
  assert.equal(migrationDatabaseUrl({ DATABASE_URL: supabase }), supabase);
});

test("missing or malformed URLs are passed through, never invented", () => {
  assert.equal(migrationDatabaseUrl({}), undefined);
  assert.equal(migrationDatabaseUrl({ DATABASE_URL: "not-a-url" }), "not-a-url");
});
