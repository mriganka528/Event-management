import "dotenv/config";

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { PrismaClient, RoleKey, AccountStatus } from "@prisma/client";

const dev = process.env.NODE_ENV !== "production" && !process.argv.includes("--production");
if (!process.env.NODE_ENV) process.env.NODE_ENV = dev ? "development" : "production";
const hostname = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const nextApp = next({ dev, hostname, port });
const handle = nextApp.getRequestHandler();
const prisma = new PrismaClient();

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

httpServer.listen(port, hostname, () => {
  console.log(`> Event management server ready on http://${hostname}:${port}`);
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
