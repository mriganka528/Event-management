import "dotenv/config";

import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { createHash } from "node:crypto";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { PrismaClient, RoleKey, AccountStatus } from "@prisma/client";

import { pooledDatabaseUrl } from "./lib/prisma-pool.mjs";

const dev = process.env.NODE_ENV !== "production" && !process.argv.includes("--production");
if (!process.env.NODE_ENV) process.env.NODE_ENV = dev ? "development" : "production";
const hostname = process.env.HOST ?? "0.0.0.0";

/**
 * How many ports to try before giving up. Next's own dev server uses the same
 * bound, so a conflict that outlasts it is not going to clear itself.
 */
const MAX_PORT_ATTEMPTS = 10;

/**
 * Whether a port can be bound right now.
 *
 * Opens and immediately closes a socket. Racy in principle — something else
 * could take the port between the check and the real bind — which is why
 * `listenOnAvailablePort` still handles `EADDRINUSE` as it happens rather than
 * trusting this answer.
 */
function isPortAvailable(candidate) {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(candidate, hostname);
  });
}

/**
 * Bind `httpServer`, walking up the port range when the one asked for is taken.
 *
 * Next's dev server does this itself, but only when it owns the socket — its
 * `allowRetry` lives in the code path where Next creates the server. This file
 * creates its own, so that retry never runs and a busy port is a hard crash
 * instead of a delay.
 *
 * Only in development. In production the port is not ours to choose: it is what
 * a reverse proxy, a load balancer or a platform expects to reach the app on, and
 * quietly listening somewhere else turns a clear "port in use" error into a
 * service nobody can reach.
 *
 * Resolves with the port actually bound, so the caller can report it rather than
 * the one that was asked for.
 */
function listenOnAvailablePort(httpServer, preferred) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const onError = (error) => {
      // `EACCES` means the port is reserved rather than occupied; moving up is
      // still the right response, since the range above it is usually free.
      if ((error.code === "EADDRINUSE" || error.code === "EACCES") && attempt < MAX_PORT_ATTEMPTS - 1) {
        attempt += 1;
        httpServer.listen(preferred + attempt, hostname);
        return;
      }
      httpServer.off("error", onError);
      reject(error);
    };

    httpServer.on("error", onError);
    httpServer.once("listening", () => {
      httpServer.off("error", onError);
      const address = httpServer.address();
      resolve(typeof address === "object" && address ? address.port : preferred + attempt);
    });
    httpServer.listen(preferred, hostname);
  });
}

/**
 * Pick a port before anything binds, so Next is told the same one the app will
 * listen on.
 *
 * `next()` takes the port up front and uses it for its own bookkeeping, so
 * finding the port afterwards would leave the two disagreeing.
 */
async function resolvePort(preferred) {
  if (!dev) return preferred;
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const candidate = preferred + offset;
    // Sequential by necessity: each probe binds the very port the next test
    // assumes is free, so they cannot overlap.
    if (await isPortAvailable(candidate)) {
      if (offset > 0) {
        console.warn(`> Port ${preferred} is in use, using ${candidate} instead.`);
        // Worth saying out loud, because the two failures look alike and only one
        // of them is fixable by moving ports. Next holds a lock on this project's
        // build directory, so if what is holding the port is another `npm run dev`
        // for *this* app, it will refuse to start on 3001 as well — with the far
        // less obvious "Unable to acquire lock" message.
        console.warn("> If this is another dev server for this project, stop it: the build directory lock is per project, not per port.");
      }
      return candidate;
    }
  }
  return preferred;
}

const port = await resolvePort(Number(process.env.PORT ?? 3000));
// Next reads `PORT` for its dev-server URLs and restart bookkeeping, so it has
// to reflect the port actually in use rather than the one that was requested.
process.env.PORT = String(port);
const nextApp = next({ dev, hostname, port });
const handle = nextApp.getRequestHandler();

/**
 * The Socket.IO client, separate from the one in `lib/prisma.ts` because that
 * file is TypeScript and this process runs under plain Node.
 *
 * This one only authenticates a socket and sweeps stale connections every five
 * minutes, so it is given a much smaller pool than the application's. Both share
 * the sizing rule in `lib/prisma-pool.mjs` — together they must stay well under
 * what the database will hand out, and Prisma's default of 17 each does not.
 */
const SOCKET_CONNECTION_LIMIT = 2;
const prisma = new PrismaClient({
  datasourceUrl: pooledDatabaseUrl(process.env.DATABASE_URL, SOCKET_CONNECTION_LIMIT),
});

/**
 * Must match lib/auth/cookie-names.ts. The `__Host-` prefix is only legal
 * alongside `Secure`, which a plain-http development origin cannot carry, so
 * the unprefixed name is used there. Keep in sync with the rule in
 * lib/auth/cookie-names.ts: https when x-forwarded-proto says so, otherwise
 * the deployment mode decides.
 */
const HTTPS_SESSION_COOKIE = "__Host-event_session";
const PLAIN_SESSION_COOKIE = "event_session";

function sessionCookieName(forwardedProto) {
  const proto = (forwardedProto || "").split(",")[0].trim();
  const https = proto ? proto === "https" : process.env.NODE_ENV === "production";
  return https ? HTTPS_SESSION_COOKIE : PLAIN_SESSION_COOKIE;
}

function parseCookies(header) {
  const out = new Map();
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (key) out.set(key, decodeURIComponent(part.slice(index + 1).trim()));
  }
  return out;
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

await nextApp.prepare();

const httpServer = createServer((request, response) => handle(request, response));
const configuredOrigins = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").split(",").map((value) => value.trim()).filter(Boolean).map((value) => { try { return new URL(value).origin; } catch { return null; } }).filter(Boolean);
if (!dev && configuredOrigins.length === 0) throw new Error("APP_URL or NEXT_PUBLIC_SITE_URL is required in production for Socket.IO origin protection.");
const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : [`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://0.0.0.0:${port}`];
const io = new SocketIOServer(httpServer, {
  path: "/api/socket.io",
  serveClient: false,
  transports: ["websocket", "polling"],
  maxHttpBufferSize: 1_000_000,
  cors: { origin: allowedOrigins, credentials: true },
});

globalThis.__tentHouseRealtime = io;
const socketBuckets = new Map();

io.use(async (socket, nextMiddleware) => {
  const now = Date.now();
  if (socketBuckets.size > 10_000) {
    for (const [bucketAddress, bucket] of socketBuckets) {
      if (bucket.resetAt <= now) socketBuckets.delete(bucketAddress);
    }
    while (socketBuckets.size > 10_000) socketBuckets.delete(socketBuckets.keys().next().value);
  }
  const address = socket.handshake.address || "unknown";
  const current = socketBuckets.get(address);
  if (!current || current.resetAt <= now) socketBuckets.set(address, { count: 1, resetAt: now + 60_000 });
  else if (current.count >= 30) { nextMiddleware(new Error("Too many socket connections")); return; }
  else current.count += 1;

  // The session cookie is HttpOnly, so the client can neither read nor forge it.
  // Only the SHA-256 hash is stored, and the account must still be active and
  // approved, so a suspended user loses live updates within minutes.
  const token = parseCookies(socket.handshake.headers.cookie).get(sessionCookieName(socket.handshake.headers["x-forwarded-proto"]));
  if (!token || token.length < 20 || token.length > 200) {
    nextMiddleware(new Error("Authentication required"));
    return;
  }

  try {
    const user = await prisma.user.findFirst({
      where: {
        // `sessions`, not `authSessions`: the relation is named after the field on
        // User, and `authSessions` is only the *model* name. Prisma rejects an
        // unknown key, the throw was swallowed, and every single handshake answered
        // "Authentication failed" — which is why the live badge sat on "Connecting"
        // forever no matter how healthy the connection actually was.
        sessions: { some: { tokenHash: sha256(token), status: "ACTIVE" } },
        isActive: true,
        accountStatus: AccountStatus.ACTIVE,
      },
      select: { id: true, role: { select: { key: true } } },
    });
    if (!user) throw new Error("Active account not found");
    socket.data.userId = user.id;
    socket.data.role = user.role.key;
    nextMiddleware();
  } catch (error) {
    // Logged rather than swallowed: a silent catch here turned a bad query into a
    // permanently broken feature with nothing to diagnose it from.
    console.error("[socket] authentication failed:", error instanceof Error ? error.message : error);
    nextMiddleware(new Error("Authentication failed"));
  }
});

io.on("connection", (socket) => {
  const userId = String(socket.data.userId);
  const role = String(socket.data.role);
  socket.join(`user:${userId}`);
  if (role === RoleKey.SUPER_ADMIN || role === RoleKey.ADMIN) socket.join("admins");
  if (role === RoleKey.STAFF) socket.join("staff");
  socket.emit("realtime:ready", { connectedAt: new Date().toISOString() });
});

const revalidateSockets = setInterval(async () => {
  const sockets = await io.fetchSockets();
  await Promise.all(sockets.map(async (socket) => {
    // Re-checked on a timer so a suspension or demotion drops live membership
    // within minutes, without waiting for the user to refresh the browser.
    const user = await prisma.user.findFirst({ where: { id: socket.data.userId, isActive: true, accountStatus: "ACTIVE" }, select: { role: { select: { key: true } } } }).catch(() => null);
    if (!user) { socket.disconnect(true); return; }
    socket.data.role = user.role.key;
    socket.leave("admins");
    socket.leave("staff");
    if (user.role.key === RoleKey.SUPER_ADMIN || user.role.key === RoleKey.ADMIN) socket.join("admins");
    if (user.role.key === RoleKey.STAFF) socket.join("staff");
  }));
}, 5 * 60_000);
revalidateSockets.unref();

listenOnAvailablePort(httpServer, port)
  .then((listeningOn) => {
    // The bound port is what every URL has to name, and it can differ from the
    // requested one if something took it in between.
    if (listeningOn !== port) {
      console.warn(`> Port ${port} was taken while starting, using ${listeningOn} instead.`);
      process.env.PORT = String(listeningOn);
    }
    console.log(`> Event management server ready on http://${hostname}:${listeningOn}`);
  })
  .catch((error) => {
    console.error("> Failed to start the server:", error instanceof Error ? error.message : error);
    process.exit(1);
  });

async function shutdown() {
  clearInterval(revalidateSockets);
  io.close();
  httpServer.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
