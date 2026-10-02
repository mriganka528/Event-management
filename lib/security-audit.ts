import "server-only";

import type { SecurityEventType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Append-only security audit trail.
 *
 * Auditing must never break the request it is recording, so every write is
 * fire-and-forget: a failed insert is swallowed rather than surfaced to the
 * user or propagated into a page render.
 */
export type SecurityEventInput = {
  type: SecurityEventType;
  userId?: string | null;
  email?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  detail?: string | null;
};

export async function recordSecurityEvent(input: SecurityEventInput) {
  try {
    await prisma.securityEvent.create({
      data: {
        type: input.type,
        userId: input.userId ?? null,
        email: input.email ? input.email.slice(0, 254) : null,
        ipAddress: input.ipAddress ? input.ipAddress.slice(0, 64) : null,
        userAgent: input.userAgent ? input.userAgent.slice(0, 300) : null,
        detail: input.detail ? input.detail.slice(0, 500) : null,
      },
    });
  } catch {
    // Never let audit persistence affect the caller.
  }
}

/** Best-effort capture of the current request's network context. */
export async function currentRequestFingerprint() {
  try {
    const { headers } = await import("next/headers");
    const store = await headers();
    return {
      ipAddress: store.get("x-forwarded-for")?.split(",")[0]?.trim() ?? store.get("x-real-ip") ?? null,
      userAgent: store.get("user-agent")?.slice(0, 300) ?? null,
    };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}
