/**
 * The connection string Prisma CLI should use for schema work and migrations.
 *
 * Neon (and several other hosts) give you two URLs for the same database:
 *
 *   - a pooled host containing `-pooler`, used by the running application, and
 *   - a direct host without it, used for migrations.
 *
 * Migrations are not safe through a transaction-mode pooler. Prisma takes a
 * session-level advisory lock before applying migrations, but PgBouncer may
 * hand the lock and the following statements to different backends, or keep
 * the lock waiting behind an already busy pool. On Vercel that surfaced as:
 *
 *   P1002: Timed out trying to acquire a postgres advisory lock
 *   (SELECT pg_advisory_lock(72707369)). Timeout: 10000ms.
 *
 * The runtime client keeps using DATABASE_URL. Only the CLI needs this direct
 * URL, so `prisma.config.ts` uses this helper while `lib/prisma.ts` still opens
 * its bounded pool against the pooled URL.
 *
 * Resolution order:
 *
 *   1. DIRECT_URL, the conventional explicit variable.
 *   2. DATABASE_URL_UNPOOLED / POSTGRES_URL_NON_POOLING, supplied by the Neon
 *      and Vercel Postgres integrations.
 *   3. DATABASE_URL with `-pooler.` removed from a Neon hostname. This keeps a
 *      normal Vercel project working without an extra environment variable.
 *   4. DATABASE_URL unchanged, for direct hosts and other providers.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | undefined}
 */
export function migrationDatabaseUrl(env = process.env) {
  const explicit =
    env.DIRECT_URL || env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING;
  if (explicit) return explicit;

  const raw = env.DATABASE_URL;
  if (!raw) return undefined;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    // Never rewrite something we cannot parse; the database connection will
    // produce the useful error instead of a misleading one here.
    return raw;
  }

  // Only Neon's `-pooler` suffix is known to have a predictable direct twin.
  // Supabase and other poolers need their direct URL supplied explicitly above.
  if (!parsed.hostname.includes("-pooler.")) return raw;

  parsed.hostname = parsed.hostname.replace("-pooler.", ".");
  // PgBouncer-specific settings do not belong on a direct connection and would
  // silently disable prepared statements for the migration session.
  parsed.searchParams.delete("pgbouncer");

  return parsed.toString();
}
