import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { pooledDatabaseUrl } from "../lib/prisma-pool.mjs";

/**
 * Connection-pool sizing.
 *
 * Prisma defaults to `num_cpus * 2 + 1` connections — 17 on a typical machine —
 * because that default assumes Postgres is on the same box. This app points at
 * Neon behind PgBouncer, which is there precisely so that many client connections
 * multiplex over a few real ones, so the default is the wrong shape twice over.
 *
 * Two clients made it worse: `lib/prisma.ts` for the application and
 * `server.mjs` for Socket.IO, so up to 34 connections. Under load the symptom was
 * pages taking 4-12 seconds and then failing with
 * `Timed out fetching a new connection from the connection pool`.
 *
 * The dangerous half is `pgbouncer=true`: it makes Prisma drop prepared
 * statements, which transaction-mode pooling cannot support. Getting that wrong
 * costs a round trip per query, silently, so the detection stays narrow and these
 * tests pin where it does and does not apply.
 */

const POOLER = "postgresql://user:pass@ep-abc123-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const DIRECT = "postgresql://user:pass@ep-abc123.us-east-2.aws.neon.tech/neondb?sslmode=require";

/**
 * The helper accepts `undefined` because it is called at module load with a value
 * read straight from the environment. Every case below passes a real URL, so the
 * narrowing is asserted rather than assumed.
 */
function pooled(url: string, limit: number): URL {
  const result = pooledDatabaseUrl(url, limit);
  assert.notEqual(result, undefined, `pooling a defined URL must produce one, received ${String(result)}`);
  return new URL(result as string);
}

test("a pooled host gets both settings", () => {
  const result = pooled(POOLER, 5);
  assert.equal(result.searchParams.get("connection_limit"), "5");
  // Only safe here: PgBouncer in transaction mode cannot hold a prepared
  // statement across transactions, so Prisma has to be told to stop using them.
  assert.equal(result.searchParams.get("pgbouncer"), "true");
  // …and the original settings survive untouched.
  assert.equal(result.hostname, "ep-abc123-pooler.us-east-2.aws.neon.tech");
  assert.equal(result.searchParams.get("sslmode"), "require");
  assert.equal(result.username, "user");
});

test("a direct host gets a bounded pool but keeps prepared statements", () => {
  // Pooling Postgres directly still wants a bound — it is good hygiene — but
  // there is no PgBouncer in the path, so `pgbouncer=true` would be a pure loss.
  const result = pooled(DIRECT, 5);
  assert.equal(result.searchParams.get("connection_limit"), "5");
  assert.equal(result.searchParams.has("pgbouncer"), false);
});

test("a deliberate override is never overwritten", () => {
  // An operator who raises the ceiling for a heavier deployment must not have it
  // silently reset on every deploy.
  const raised = pooled(`${POOLER}&connection_limit=12`, 5);
  assert.equal(raised.searchParams.get("connection_limit"), "12");

  const alreadyOff = pooled(`${POOLER}&pgbouncer=false`, 5);
  assert.equal(alreadyOff.searchParams.get("pgbouncer"), "false");
});

test("a missing or unparseable URL is passed through untouched", () => {
  // The helper runs at module load, before anything can report an error usefully.
  // Returning the input unchanged is safer than throwing here.
  assert.equal(pooledDatabaseUrl(undefined, 5), undefined);
  assert.equal(pooledDatabaseUrl("", 5), "");
  assert.equal(pooledDatabaseUrl("not-a-url", 5), "not-a-url");
});

test("an unusable pool limit is rejected rather than silently ignored", () => {
  // A limit of 0, or NaN, would leave the pool unbounded again — the exact bug
  // this exists to fix — so it must fail loudly at startup.
  for (const limit of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => pooledDatabaseUrl(POOLER, limit),
      /positive integer/,
      `a limit of ${limit} should be rejected, not silently dropped`,
    );
  }
});

test("both clients in this process are bounded", () => {
  // The fix only holds if the Socket.IO client uses it too: two unbounded pools
  // is the problem, not one.
  const app = readFileSync("lib/prisma.ts", "utf8");
  const sockets = readFileSync("server.mjs", "utf8");

  assert.match(app, /pooledDatabaseUrl\(process\.env\.DATABASE_URL, CONNECTION_LIMIT\)/, "lib/prisma.ts is not using the shared rule");
  assert.match(sockets, /pooledDatabaseUrl\(process\.env\.DATABASE_URL, SOCKET_CONNECTION_LIMIT\)/, "server.mjs is not using the shared rule");

  // Neither may construct a bare client, which is what silently reverted to the
  // 17-connection default.
  for (const [file, source] of [
    ["lib/prisma.ts", app],
    ["server.mjs", sockets],
  ] as const) {
    assert.doesNotMatch(
      source,
      /new PrismaClient\(\s*\)/,
      `${file} constructs a default-sized pool; every client needs an explicit limit`,
    );
  }
});

test("the two pools together stay well inside the old default", () => {
  const limitOf = (file: string, name: string) =>
    Number(new RegExp(`const ${name} = (\\d+);`).exec(readFileSync(file, "utf8"))?.[1]);

  const app = limitOf("lib/prisma.ts", "CONNECTION_LIMIT");
  const sockets = limitOf("server.mjs", "SOCKET_CONNECTION_LIMIT");

  assert.ok(Number.isInteger(app) && app > 0, "the application pool needs an explicit limit");
  assert.ok(Number.isInteger(sockets) && sockets > 0, "the socket pool needs an explicit limit");

  const total = app + sockets;
  // Prisma's default on a typical 8-core machine was 17 *per client*. This is the
  // regression guard for the number that actually caused the timeouts.
  assert.ok(total <= 10, `total pool of ${total} is too close to the 34-connection shape that timed out`);
  // And the busy client still has to be worth queueing on.
  assert.ok(app >= sockets, "the application handles every query, so it cannot have the smaller pool");
});