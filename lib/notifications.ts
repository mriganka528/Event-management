import "server-only";
import { AccountStatus, NotificationAudience, NotificationType, RoleKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { emitAdminNotification, emitUserNotification } from "@/lib/realtime";

export { emitUserNotification };

export type AdminRecipients = { id: string; email: string }[];

/**
 * Only live, approved administrators are notified, so a suspended admin's
 * inbox cannot be used to keep receiving operational and payment data.
 */
export async function listAdminRecipients(): Promise<AdminRecipients> {
  return prisma.user.findMany({
    where: { isActive: true, accountStatus: AccountStatus.ACTIVE, role: { key: { in: [RoleKey.SUPER_ADMIN, RoleKey.ADMIN] } } },
    select: { id: true, email: true },
  });
}

/**
 * Creates one notification per admin and pushes each one over the socket so
 * the admin bell, toast, and browser notification update immediately.
 * Call this AFTER the surrounding transaction commits.
 */
export async function notifyAdmins(input: { type: NotificationType; title: string; message: string; href?: string }) {
  const admins = await listAdminRecipients();
  if (admins.length === 0) return [];
  /*
   * The rows come back with the insert rather than being looked up again.
   *
   * Re-reading them by title and message could return an older notification
   * with the same wording, which would push a stale row over the socket and
   * show the admin a notification they had already seen.
   */
  const notifications = await prisma.notification.createManyAndReturn({
    data: admins.map((admin) => ({ userId: admin.id, audience: NotificationAudience.ADMIN, type: input.type, title: input.title, message: input.message, href: input.href ?? null })),
  });
  for (const notification of notifications) emitAdminNotification(notification, input.href);
  return notifications;
}

/**
 * Best-effort admin notification.
 *
 * Payment callers use this after the money movement has committed: a failing
 * inbox must never turn a recorded payment into an error the admin retries.
 */
export async function notifyAdminsSafely(input: { type: NotificationType; title: string; message: string; href?: string }) {
  try {
    return await notifyAdmins(input);
  } catch (error) {
    console.error("Admin notification failed.", error);
    return [];
  }
}

/** Creates a notification for one user and pushes it over their personal room. */
export async function notifyUser(userId: string, input: { type: NotificationType; title: string; message: string; href?: string }) {
  const notification = await prisma.notification.create({
    data: { userId, audience: NotificationAudience.CUSTOMER, type: input.type, title: input.title, message: input.message, href: input.href ?? null },
  });
  emitUserNotification(userId, notification, input.href);
  return notification;
}

/** Pushes notifications that were already created inside a transaction. */
export function emitExistingNotifications<T extends { id: string; title: string; message: string; type: NotificationType; read: boolean; createdAt: Date }>(notifications: T[], href?: string) {
  for (const notification of notifications) emitAdminNotification(notification, href);
}
