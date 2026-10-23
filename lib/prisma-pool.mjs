/**
 * Connection-pool sizing.
 *
 * Prisma sizes its own pool at `num_cpus * 2 + 1` — 17 connections on a typical
 * developer machine — because that default assumes Postgres is running on the same
 * box. This application points at Neon, which sits behind PgBouncer specifically
 * so that many client connections can be multiplexed over a handful of real ones.
 * A 17-connection pool in front of a pooler is the wrong shape twice over: the
 * pooler is asked to do the multiplexing Prisma is already doing, and the extra
 * connections are what exhaust the pool. The symptom was pages taking 4-12
 * seconds and then failing with:
 *
 *   Timed out fetching a new connection from the connection pool.
 *   (Current connection pool timeout: 10, connection limit: 17)
 *
 * This process runs **two** clients — `lib/prisma.ts` for the application and
 * `server.mjs` for Socket.IO — so the default added up to 34 connections. Each is
 * given a deliberately small pool here; the pooler does the multiplexing.
 *
 * Plain `.mjs` with JSDoc types rather than TypeScript, because `server.mjs` runs
 * under plain Node with no transpiler and still has to use the same rule.
 */

/**
 * Whether the URL points at a pooler rather than at Postgres directly.
 *
 * Only a host with `-pooler.` in it counts. This is the check that gates the
 * dangerous half of the fix: `pgbouncer=true` makes Prisma stop using prepared
 * statements, which transaction-mode pooling cannot support. Guessing wrong in
 * that direction silently costs a round trip per query, so the detection stays
 * narrow.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
function isPoolerHost(hostname) {
  return hostname.includes("-pooler.");
}

/**
 * Returns `DATABASE_URL` with pool settings appropriate for the server it points
 * at, or unchanged when it cannot be parsed.
 *
 * Anything already present in the URL wins, so a deliberate override is never
 * overwritten — append `?connection_limit=10` to raise the ceiling for a
 * heavier deployment.
 *
 * @param {string | undefined} url
 * @param {number} limit
 * @returns {string | undefined}
 */
export function pooledDatabaseUrl(url, limit) {
  if (!url) return url;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    // Not a URL we can reason about, so leave it exactly as the operator set it.
    return url;
  }

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Connection pool limit must be a positive integer, received ${limit}.`);
  }

  // Safe for any Postgres, not just a pooled one: bounding the pool is good
  // hygiene regardless of what sits behind it.
  if (!parsed.searchParams.has("connection_limit")) {
    parsed.searchParams.set("connection_limit", String(limit));
  }

  if (isPoolerHost(parsed.hostname) && !parsed.searchParams.has("pgbouncer")) {
    parsed.searchParams.set("pgbouncer", "true");
  }

  return parsed.toString();
}