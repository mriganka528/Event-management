import { NextResponse } from "next/server";
import { NotificationAudience } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { accessDenied, requireApiCustomer } from "@/lib/route-guards";
import { AuthError } from "@/lib/route-guards";
import { rateLimitApi, withNoStore } from "@/lib/security";
import { toNotificationView } from "@/lib/notification-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The customer's own notification feed, for polling.
 *
 * The mirror of `/api/admin/notifications`: on a deployment with no socket
 * server, this is how a customer hears that their payment was received or
 * that the team has asked for one.
 *
 * Scoped to the caller's own rows, so it cannot be used to read anybody
 * else's inbox.
 */
export async function GET(request: Request) {
  const limited = rateLimitApi(request, "customer-notifications", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const user = await requireApiCustomer();
    const notifications = await prisma.notification.findMany({
      where: { userId: user.id, audience: NotificationAudience.CUSTOMER },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const items = notifications.map((notification) => toNotificationView(notification, "CUSTOMER"));
    return withNoStore(NextResponse.json({ items, unread: items.filter((item) => !item.read).length }));
  } catch (error) {
    if (error instanceof AuthError) return accessDenied(error);
    return withNoStore(NextResponse.json({ error: "Unable to load notifications right now." }, { status: 500 }));
  }
}
