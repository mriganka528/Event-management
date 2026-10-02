import "server-only";

export type RealtimeEventType =
  | "booking.created"
  | "booking.updated"
  | "payment.recorded"
  | "inventory.updated"
  | "catalog.updated"
  | "notification.created"
  | "staff.updated";

export type RealtimeNotification = {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: string;
  href?: string;
};

export type RealtimeEvent = {
  type: RealtimeEventType;
  entityId?: string;
  action?: string;
  notification?: RealtimeNotification;
};

type SocketEmitter = {
  to: (room: string) => { emit: (event: string, payload: unknown) => void };
};

type RealtimeGlobal = typeof globalThis & {
  __tentHouseRealtime?: SocketEmitter;
};

const realtimeGlobal = globalThis as RealtimeGlobal;

export function setRealtimeEmitter(emitter: SocketEmitter) {
  realtimeGlobal.__tentHouseRealtime = emitter;
}

export function emitAdminEvent(type: RealtimeEventType, payload: Omit<RealtimeEvent, "type"> = {}) {
  realtimeGlobal.__tentHouseRealtime?.to("admins").emit("realtime:event", { type, ...payload });
}

export function emitUserEvent(userId: string, type: RealtimeEventType, payload: Omit<RealtimeEvent, "type"> = {}) {
  realtimeGlobal.__tentHouseRealtime?.to(`user:${userId}`).emit("realtime:event", { type, ...payload });
}

function toRealtimeNotification(notification: { id: string; title: string; message: string; type: string; read: boolean; createdAt: Date }, href?: string) {
  return {
    id: notification.id,
    title: notification.title,
    message: notification.message,
    type: String(notification.type),
    read: notification.read,
    createdAt: notification.createdAt.toISOString(),
    ...(href ? { href } : {}),
  };
}

/** Pushes a freshly created notification to every connected admin in realtime. */
export function emitAdminNotification(notification: { id: string; title: string; message: string; type: string; read: boolean; createdAt: Date }, href?: string) {
  emitAdminEvent("notification.created", { notification: toRealtimeNotification(notification, href) });
}

/** Pushes a freshly created notification to a single connected user. */
export function emitUserNotification(userId: string, notification: { id: string; title: string; message: string; type: string; read: boolean; createdAt: Date }, href?: string) {
  emitUserEvent(userId, "notification.created", { notification: toRealtimeNotification(notification, href) });
}
