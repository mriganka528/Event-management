import "server-only";

import { cookies, headers } from "next/headers";
import { OtpChannel, SessionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateToken, sha256 } from "@/lib/auth/password";
import { isHttps, sessionCookieName, DEVICE_COOKIE } from "@/lib/auth/cookie-names";
import { getClientIp } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/security-audit";

/**
 * First-party session handling.
 *
 * A session is an opaque 256-bit token. Only its SHA-256 hash is stored, so a
 * database leak cannot be replayed as a login. The token lives in a
 * `HttpOnly`, `SameSite=Lax`, `Secure`, `__Host-` cookie whenever the request
 * arrived over HTTPS — see `lib/auth/cookie-names.ts` for why the prefix is
 * dropped on plain-http development.
 *
 * DEVICE LIMIT
 * ------------
 * An account may hold at most `MAX_DEVICES_PER_ACCOUNT` ACTIVE sessions. A new
 * sign-in on a *different* device is refused once that cap is reached; the user
 * must revoke a device first. Re-authenticating on a device that already holds
 * a session rotates that session rather than consuming a new slot, so a
 * re-login on a known machine never locks anyone out.
 */

export { DEVICE_COOKIE };

export function maxDevices(): number {
  const raw = Number(process.env.MAX_DEVICES_PER_ACCOUNT ?? 4);
  if (!Number.isFinite(raw)) return 4;
  return Math.min(Math.max(Math.trunc(raw), 1), 50);
}

export class DeviceLimitError extends Error {
  readonly code = "DEVICE_LIMIT_REACHED";
  constructor(readonly activeDevices: number) {
    super(`This account is already signed in on ${activeDevices} devices. Sign one of them out before using another.`);
  }
}

/**
 * Whether the current request arrived over HTTPS.
 *
 * Behind a proxy the request URL may be plain http, so the forwarded protocol
 * header is consulted first. The answer also picks the cookie name: the
 * `__Host-` prefix is only legal alongside `Secure`.
 */
async function isSecureRequest(): Promise<boolean> {
  try {
    const store = await headers();
    return isHttps(store.get("x-forwarded-proto"), process.env.NODE_ENV === "production");
  } catch {
    // Outside a request scope (scripts, tests) fall through to the env check.
    return process.env.NODE_ENV === "production";
  }
}

export type DeviceInfo = { deviceId: string; deviceLabel: string | null; ipAddress: string | null; userAgent: string | null };

export async function currentRequestInfo(): Promise<DeviceInfo> {
  // `headers()` yields the raw request headers, so the device cookie is a plain
  // string here (unlike `cookies()`, which wraps it in a RequestCookie).
  const store = await headers();
  const cookieDevice = store.get(DEVICE_COOKIE);
  const userAgent = store.get("user-agent") ?? "";
  return {
    deviceId: cookieDevice && /^[A-Za-z0-9_-]{8,64}$/.test(cookieDevice) ? cookieDevice : fingerprint(userAgent),
    deviceLabel: describeDevice(userAgent),
    ipAddress: getClientIp({ headers: store }),
    userAgent: userAgent.slice(0, 300) || null,
  };
}

/**
 * A stable, non-identifying device id derived from coarse request traits. It is
 * only used to recognise "the same device"; the session token remains the actual
 * credential, so a spoofed value gains nothing.
 */
function fingerprint(userAgent: string | null): string {
  const seed = `${userAgent ?? "unknown"}|${process.env.SESSION_FINGERPRINT_SALT ?? "salt"}`;
  return sha256(seed).slice(0, 32);
}

function describeDevice(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = /Firefox\/[\d.]+/.test(userAgent) ? "Firefox"
    : /Edg\//.test(userAgent) ? "Edge"
    : /Chrome\//.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari"
    : "Browser";
  const os = /Windows/.test(userAgent) ? "Windows"
    : /Android/.test(userAgent) ? "Android"
    : /iPhone|iPad/.test(userAgent) ? "iOS"
    : /Mac OS X/.test(userAgent) ? "macOS"
    : /Linux/.test(userAgent) ? "Linux"
    : "Unknown OS";
  return `${browser} on ${os}`;
}

export async function activeDeviceCount(userId: string): Promise<number> {
  return prisma.authSession.count({ where: { userId, status: SessionStatus.ACTIVE } });
}

export async function listActiveDevices(userId: string, currentTokenHash?: string) {
  const sessions = await prisma.authSession.findMany({
    where: { userId, status: SessionStatus.ACTIVE },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, deviceId: true, deviceLabel: true, ipAddress: true, lastSeenAt: true, createdAt: true, tokenHash: true },
  });
  return sessions.map((session) => ({
    id: session.id,
    deviceLabel: session.deviceLabel,
    ipAddress: session.ipAddress,
    lastSeenAt: session.lastSeenAt,
    createdAt: session.createdAt,
    isCurrent: currentTokenHash ? session.tokenHash === currentTokenHash : false,
  }));
}

/**
 * Issues a session, enforcing the per-account device cap.
 *
 * `rotateDeviceId` lets the caller keep an existing slot when the same browser
 * is re-authenticating, so only genuinely new devices consume a slot.
 */
export async function createSession(input: {
  userId: string;
  twoFactorUsed?: OtpChannel | null;
  info: DeviceInfo;
  /** Device already holding a session that may be replaced, if any. */
  existingDeviceId?: string | null;
}): Promise<{ token: string; sessionId: string; activeDevices: number; replaced: boolean }> {
  const limit = maxDevices();
  const cap = await activeDeviceCount(input.userId);
  const existing = input.existingDeviceId
    ? await prisma.authSession.findFirst({
        where: { userId: input.userId, deviceId: input.existingDeviceId, status: SessionStatus.ACTIVE },
        select: { id: true },
      })
    : null;

  if (!existing && cap >= limit) {
    await recordSecurityEvent({
      type: "DEVICE_LIMIT_REACHED",
      userId: input.userId,
      ipAddress: input.info.ipAddress,
      userAgent: input.info.userAgent,
      detail: `Sign-in refused: ${cap} of ${limit} device slots in use (${input.info.deviceLabel ?? "unknown"}).`,
    });
    throw new DeviceLimitError(cap);
  }

  const token = generateToken(32);
  const tokenHash = sha256(token);

  if (existing) {
    // Re-login on a known device: rotate in place, never burn a new slot.
    await prisma.authSession.update({
      where: { id: existing.id },
      data: {
        tokenHash,
        ipAddress: input.info.ipAddress,
        userAgent: input.info.userAgent,
        deviceLabel: input.info.deviceLabel,
        lastSeenAt: new Date(),
        twoFactorUsed: input.twoFactorUsed ?? null,
      },
    });
    await recordSecurityEvent({ type: "DEVICE_SESSION_CREATED", userId: input.userId, ipAddress: input.info.ipAddress, userAgent: input.info.userAgent, detail: `Session rotated on ${input.info.deviceLabel ?? "known device"}.` });
    return { token, sessionId: existing.id, activeDevices: cap, replaced: true };
  }

  const session = await prisma.authSession.create({
    data: {
      userId: input.userId,
      tokenHash,
      deviceId: input.info.deviceId,
      deviceLabel: input.info.deviceLabel,
      ipAddress: input.info.ipAddress,
      userAgent: input.info.userAgent,
      twoFactorUsed: input.twoFactorUsed ?? null,
    },
    select: { id: true },
  });

  await recordSecurityEvent({
    type: "DEVICE_SESSION_CREATED",
    userId: input.userId,
    ipAddress: input.info.ipAddress,
    userAgent: input.info.userAgent,
    detail: `Signed in on ${input.info.deviceLabel ?? "unknown device"} (${cap + 1} of ${limit}).`,
  });

  return { token, sessionId: session.id, activeDevices: cap + 1, replaced: false };
}

export async function setSessionCookies(token: string, deviceId: string) {
  const store = await cookies();
  const secure = await isSecureRequest();
  const maxAge = sessionMaxAgeSeconds();

  store.set(sessionCookieName(secure), token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  // Readable by the client so the browser can present a stable device id.
  store.set(DEVICE_COOKIE, deviceId, {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export function sessionMaxAgeSeconds(): number {
  const hours = Number(process.env.SESSION_MAX_AGE_HOURS ?? 12);
  return Math.min(Math.max(Number.isFinite(hours) ? hours : 12, 1), 24 * 30) * 3600;
}

export async function clearSessionCookies() {
  const store = await cookies();
  const secure = await isSecureRequest();
  // Both names are cleared: a session opened before an http/https switch, or a
  // browser still holding a cookie under the other name, must not survive.
  store.delete(sessionCookieName(secure));
  store.delete(sessionCookieName(!secure));
  store.delete(DEVICE_COOKIE);
}

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  const secure = await isSecureRequest();
  const token = store.get(sessionCookieName(secure))?.value ?? store.get(sessionCookieName(!secure))?.value;
  if (!token || token.length < 20 || token.length > 200) return null;
  return token;
}

export async function revokeSession(sessionId: string, reason: string, userId?: string) {
  await prisma.authSession.updateMany({
    where: { id: sessionId, ...(userId ? { userId } : {}) },
    data: { status: SessionStatus.REVOKED, revokedAt: new Date(), revokedReason: reason },
  });
}

export async function revokeAllSessions(userId: string, reason: string) {
  const result = await prisma.authSession.updateMany({
    where: { userId, status: SessionStatus.ACTIVE },
    data: { status: SessionStatus.REVOKED, revokedAt: new Date(), revokedReason: reason },
  });
  await recordSecurityEvent({ type: "DEVICE_SESSION_REVOKED", userId, detail: `${result.count} session(s) revoked: ${reason}` });
  return result.count;
}

/** Marks a session as still in use; throttled to at most once a minute. */
export async function touchSession(sessionId: string) {
  const session = await prisma.authSession.findUnique({ where: { id: sessionId }, select: { lastSeenAt: true } });
  if (!session) return;
  if (Date.now() - session.lastSeenAt.getTime() < 60_000) return;
  await prisma.authSession.update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
}

export async function purgeExpiredSessions() {
  await prisma.authSession.deleteMany({ where: { status: SessionStatus.REVOKED, revokedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }).catch(() => undefined);
}
