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
  const created = await prisma.notification.createMany({
    data: admins.map((admin) => ({ userId: admin.id, audience: NotificationAudience.ADMIN, type: input.type, title: input.title, message: input.message })),
  });
  const notifications = await prisma.notification.findMany({
    where: { audience: NotificationAudience.ADMIN, type: input.type, title: input.title, message: input.message, userId: { in: admins.map((a) => a.id) } },
    orderBy: { createdAt: "desc" },
    take: created.count,
  });
  for (const notification of notifications) emitAdminNotification(notification, input.href);
  return notifications;
}

/** Creates a notification for one user and pushes it over their personal room. */
export async function notifyUser(userId: string, input: { type: NotificationType; title: string; message: string; href?: string }) {
  const notification = await prisma.notification.create({
    data: { userId, audience: NotificationAudience.CUSTOMER, type: input.type, title: input.title, message: input.message },
  });
  emitUserNotification(userId, notification, input.href);
  return notification;
}

/** Pushes notifications that were already created inside a transaction. */
export function emitExistingNotifications<T extends { id: string; title: string; message: string; type: NotificationType; read: boolean; createdAt: Date }>(notifications: T[], href?: string) {
  for (const notification of notifications) emitAdminNotification(notification, href);
}
