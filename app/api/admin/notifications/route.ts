import { NextResponse } from "next/server";
import { NotificationAudience } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { accessDenied, requireApiAdmin } from "@/lib/route-guards";
import { AuthError } from "@/lib/route-guards";
import { rateLimitApi, withNoStore } from "@/lib/security";
import { toNotificationView } from "@/lib/notification-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The admin's notification feed, for polling.
 *
 * A serverless deployment has no socket server, so the notification centre
 * falls back to asking for the latest notifications instead of waiting for a
 * push. This endpoint answers that question and nothing else: the newest
 * notifications for the signed-in administrator, and how many of them are
 * unread.
 *
 * It is deliberately read-only and scoped to the caller's own rows, so it
 * cannot be used to read another administrator's inbox.
 */
export async function GET(request: Request) {
  const limited = rateLimitApi(request, "admin-notifications", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const user = await requireApiAdmin();
    const notifications = await prisma.notification.findMany({
      where: { userId: user.id, audience: NotificationAudience.ADMIN },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const items = notifications.map((notification) => toNotificationView(notification, "ADMIN"));
    return withNoStore(NextResponse.json({ items, unread: items.filter((item) => !item.read).length }));
  } catch (error) {
    if (error instanceof AuthError) return accessDenied(error);
    return withNoStore(NextResponse.json({ error: "Unable to load notifications right now." }, { status: 500 }));
  }
}
