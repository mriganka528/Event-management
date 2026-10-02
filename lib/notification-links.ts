export type NotificationLinkType =
  | "BOOKING_APPROVED"
  | "BOOKING_REJECTED"
  | "PAYMENT_RECEIVED"
  | "EVENT_REMINDER"
  | "NEW_BOOKING_REQUEST"
  | "LOW_INVENTORY"
  | "UPCOMING_EVENT"
  | "STAFF_INVITE"
  | "STAFF_REQUEST"
  | "STAFF_ACTIVATED";

export type NotificationView = {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: string;
  href: string;
};

const ADMIN_LINKS: Record<string, string> = {
  NEW_BOOKING_REQUEST: "/admin/bookings?status=PENDING",
  BOOKING_APPROVED: "/admin/bookings",
  BOOKING_REJECTED: "/admin/bookings",
  EVENT_REMINDER: "/admin/calendar",
  UPCOMING_EVENT: "/admin/calendar",
  LOW_INVENTORY: "/admin/inventory",
  PAYMENT_RECEIVED: "/admin/payments",
  STAFF_REQUEST: "/admin/admins",
  STAFF_INVITE: "/admin/staff",
  STAFF_ACTIVATED: "/admin/staff",
};

const CUSTOMER_LINKS: Record<string, string> = {
  BOOKING_APPROVED: "/customer/dashboard",
  BOOKING_REJECTED: "/customer/dashboard",
  PAYMENT_RECEIVED: "/customer/dashboard",
  EVENT_REMINDER: "/customer/dashboard",
  STAFF_INVITE: "/staff",
};

export function notificationHref(type: string, audience: "ADMIN" | "CUSTOMER", explicit?: string) {
  if (explicit) return explicit;
  const map = audience === "ADMIN" ? ADMIN_LINKS : CUSTOMER_LINKS;
  return map[type] ?? (audience === "ADMIN" ? "/admin" : "/customer/dashboard");
}

export function toNotificationView(
  notification: { id: string; title: string; message: string; type: string; read: boolean; createdAt: Date | string },
  audience: "ADMIN" | "CUSTOMER",
  explicitHref?: string,
): NotificationView {
  return {
    id: notification.id,
    title: notification.title,
    message: notification.message,
    type: String(notification.type),
    read: notification.read,
    createdAt: typeof notification.createdAt === "string" ? notification.createdAt : notification.createdAt.toISOString(),
    href: notificationHref(String(notification.type), audience, explicitHref),
  };
}
